const VOICE_SIGNAL_MAX_AGE_MS = 5 * 60_000;

function isStaleVoiceSignal(signal, now = Date.now()) {
  const timestamp = Number(signal?.t);
  return !Number.isFinite(timestamp) || now - timestamp > VOICE_SIGNAL_MAX_AGE_MS;
}

function shouldInitiateVoiceOffer(selfId, peerId) {
  return String(selfId) < String(peerId);
}

function shouldReplaceVoicePeer(connectionState) {
  return connectionState === "connected"
    || connectionState === "failed"
    || connectionState === "closed"
    || connectionState === "disconnected";
}

function serializeVoiceDescription(description) {
  return { type: description.type, sdp: description.sdp };
}

function getOrCreateVoicePeer(peers, peerId, createPeer) {
  if (peerId == null || peerId === "") return null;
  const existing = peers.get(peerId);
  if (existing) return existing;
  const peer = createPeer();
  peers.set(peerId, peer);
  return peer;
}

function getNegotiatedVoiceTransceiver(peer, fallback) {
  return peer.getTransceivers().find(transceiver =>
    transceiver.mid !== null
    && (transceiver.sender.track?.kind === "audio" || transceiver.receiver.track?.kind === "audio")
  ) || fallback;
}

function prepareVoiceAnswerTransceiver(peer, fallback) {
  const transceiver = getNegotiatedVoiceTransceiver(peer, fallback);
  if (transceiver) transceiver.direction = "sendrecv";
  return transceiver;
}

function upsertRemoteVoiceStream(streams, peerId, incomingStream, incomingTrack) {
  if (peerId == null || peerId === "" || !incomingStream) return null;
  const existingStream = streams.get(peerId);
  if (!existingStream || existingStream.getTracks().every(track => track.readyState === "ended")) {
    streams.set(peerId, incomingStream);
    return incomingStream;
  }
  if (existingStream === incomingStream) return existingStream;

  const existingTracks = existingStream.getTracks();
  const incomingTracks = incomingStream.getTracks();
  const tracks = incomingTracks.length ? incomingTracks : incomingTrack ? [incomingTrack] : [];
  for (const track of tracks) {
    if (!existingTracks.some(existing => existing === track || (track.id && existing.id === track.id))) {
      existingStream.addTrack(track);
    }
  }
  return existingStream;
}

function removeRemoteVoiceStream(streams, peerId) {
  return streams.delete(peerId);
}

function activateVoiceTrack(track) {
  if (!track || track.readyState !== "live") {
    throw new Error("Microphone access did not provide a live audio track.");
  }
  track.enabled = true;
  return track;
}

async function replaceVoiceTrack(transceiver, track) {
  const sender = transceiver?.sender;
  if (!sender || typeof sender.replaceTrack !== "function") {
    throw new Error("Could not find an audio sender for this voice connection.");
  }
  if (track) transceiver.direction = "sendrecv";
  await sender.replaceTrack(track);
  return sender;
}

async function replaceVoiceTracks(transceivers, track, onReplaced) {
  const results = await Promise.allSettled(Array.from(transceivers, async ([peerId, transceiver]) => {
    const sender = await replaceVoiceTrack(transceiver, track);
    onReplaced?.(peerId, sender, transceiver);
    return { peerId, sender };
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

module.exports = {
  VOICE_SIGNAL_MAX_AGE_MS,
  activateVoiceTrack,
  getOrCreateVoicePeer,
  getNegotiatedVoiceTransceiver,
  isStaleVoiceSignal,
  prepareVoiceAnswerTransceiver,
  replaceVoiceTrack,
  replaceVoiceTracks,
  serializeVoiceDescription,
  shouldInitiateVoiceOffer,
  shouldReplaceVoicePeer,
  removeRemoteVoiceStream,
  upsertRemoteVoiceStream,
};

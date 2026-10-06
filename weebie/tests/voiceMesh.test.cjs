const test = require("node:test");
const assert = require("node:assert/strict");
const {
  VOICE_SIGNAL_MAX_AGE_MS,
  activateVoiceTrack,
  createVoiceAnalyser,
  getNegotiatedVoiceTransceiver,
  getOrCreateVoicePeer,
  isStaleVoiceSignal,
  prepareVoiceAnswerTransceiver,
  removeRemoteVoiceStream,
  replaceVoiceTrack,
  replaceVoiceTracks,
  serializeVoiceDescription,
  shouldInitiateVoiceOffer,
  shouldReplaceVoicePeer,
  upsertRemoteVoiceStream,
} = require("../lib/voiceMesh.cjs");

test("serializes offer and answer descriptions as plain signaling data", () => {
  const description = Object.assign(Object.create({ browserPrototype: true }), {
    type: "offer",
    sdp: "v=0\r\n",
    unrelated: "not sent",
  });
  assert.deepEqual(serializeVoiceDescription(description), {
    type: "offer",
    sdp: "v=0\r\n",
  });
  assert.equal(Object.getPrototypeOf(serializeVoiceDescription(description)), Object.prototype);
});

test("marks voice signals older than sixty seconds as stale", () => {
  const now = 100_000;
  assert.equal(isStaleVoiceSignal({ t: now - VOICE_SIGNAL_MAX_AGE_MS - 1 }, now), true);
  assert.equal(isStaleVoiceSignal({ t: now - VOICE_SIGNAL_MAX_AGE_MS }, now), false);
  assert.equal(isStaleVoiceSignal({ t: now }, now), false);
  assert.equal(isStaleVoiceSignal({}, now), true);
});

test("only the lexicographically lower member initiates an offer", () => {
  assert.equal(shouldInitiateVoiceOffer("alice", "bob"), true);
  assert.equal(shouldInitiateVoiceOffer("bob", "alice"), false);
  assert.equal(shouldInitiateVoiceOffer("same", "same"), false);
});

test("only connected or unusable peers are replaced for a new offer", () => {
  for (const state of ["connected", "failed", "closed", "disconnected"]) {
    assert.equal(shouldReplaceVoicePeer(state), true);
  }
  for (const state of ["new", "connecting"]) {
    assert.equal(shouldReplaceVoicePeer(state), false);
  }
});

test("creates only one peer connection for each peer ID", () => {
  const peers = new Map();
  const first = {};
  let creations = 0;
  assert.equal(getOrCreateVoicePeer(peers, "peer-a", () => {
    creations++;
    return first;
  }), first);
  assert.equal(getOrCreateVoicePeer(peers, "peer-a", () => {
    creations++;
    return {};
  }), first);
  assert.equal(creations, 1);
  assert.equal(peers.size, 1);
  assert.equal(getOrCreateVoicePeer(peers, null, () => ({})), null);
});

test("selects the negotiated audio transceiver instead of an unused pre-created transceiver", () => {
  const unnegotiated = {
    mid: null,
    direction: "sendrecv",
    currentDirection: null,
    sender: { track: null },
    receiver: { track: { kind: "audio" } },
  };
  const negotiated = {
    mid: "0",
    direction: "recvonly",
    currentDirection: "recvonly",
    sender: { track: null },
    receiver: { track: { kind: "audio" } },
  };
  const peer = { getTransceivers: () => [unnegotiated, negotiated] };
  assert.equal(getNegotiatedVoiceTransceiver(peer, unnegotiated), negotiated);
  assert.equal(prepareVoiceAnswerTransceiver(peer, unnegotiated), negotiated);
  assert.equal(negotiated.direction, "sendrecv");
  assert.equal(unnegotiated.direction, "sendrecv");
});

function makeStream(...tracks) {
  return {
    tracks: [...tracks],
    getTracks() {
      return this.tracks;
    },
    addTrack(track) {
      this.tracks.push(track);
    },
  };
}

test("repeated ontrack for one peer keeps one remote stream without duplicating a track", () => {
  const streams = new Map();
  const track = { id: "track-a", readyState: "live" };
  const incoming = makeStream(track);
  assert.equal(upsertRemoteVoiceStream(streams, "peer-a", incoming, track), incoming);
  assert.equal(upsertRemoteVoiceStream(streams, "peer-a", incoming, track), incoming);
  assert.equal(streams.size, 1);
  assert.equal(streams.get("peer-a").getTracks().length, 1);
});

test("reconnect replaces the remote stream for the same peer ID", () => {
  const streams = new Map();
  const oldStream = makeStream({ id: "old-track", readyState: "live" });
  const newTrack = { id: "new-track", readyState: "live" };
  const newStream = makeStream(newTrack);
  streams.set("peer-a", oldStream);
  removeRemoteVoiceStream(streams, "peer-a");
  assert.equal(upsertRemoteVoiceStream(streams, "peer-a", newStream, newTrack), newStream);
  assert.equal(streams.size, 1);
  assert.equal(streams.get("peer-a"), newStream);
});

test("microphone start replaces the track on every existing peer sender", async () => {
  const replaced = [];
  const track = { kind: "audio" };
  const transceivers = new Map(["peer-a", "peer-b"].map(peerId => [peerId, {
    direction: "recvonly",
    sender: {
      track: null,
      async replaceTrack(nextTrack) {
        replaced.push([peerId, nextTrack]);
        this.track = nextTrack;
      },
    },
  }]));
  const results = await replaceVoiceTracks(transceivers, track);
  assert.deepEqual(replaced, [["peer-a", track], ["peer-b", track]]);
  assert.deepEqual(results.map(result => result.peerId), ["peer-a", "peer-b"]);
  for (const transceiver of transceivers.values()) assert.equal(transceiver.direction, "sendrecv");
});

test("microphone start re-enables a live track retained from an earlier session", () => {
  const track = { kind: "audio", enabled: false, readyState: "live" };
  assert.equal(activateVoiceTrack(track), track);
  assert.equal(track.enabled, true);
  assert.throws(() => activateVoiceTrack({ kind: "audio", readyState: "ended" }), /live audio track/);
});

test("audio analysis resume failure is reported without stopping the microphone track", async () => {
  const track = { kind: "audio", enabled: true, readyState: "live" };
  const failure = Object.assign(new Error("AudioContext blocked"), { name: "NotAllowedError" });
  const context = { resume: async () => { throw failure; } };
  const result = await createVoiceAnalyser(context, { getAudioTracks: () => [track] });
  assert.equal(result.analyser, null);
  assert.equal(result.error, failure);
  assert.equal(track.enabled, true);
  assert.equal(track.readyState, "live");
});

test("microphone stop detaches tracks without closing peers; starting again reuses them", async () => {
  const peers = new Map();
  const peer = getOrCreateVoicePeer(peers, "peer-a", () => ({ close() { throw new Error("peer must remain open"); } }));
  const replaced = [];
  const transceivers = new Map([["peer-a", {
    direction: "sendrecv",
    sender: {
      track: { kind: "audio" },
      async replaceTrack(track) {
        replaced.push(track);
        this.track = track;
      },
    },
  }]]);
  await replaceVoiceTracks(transceivers, null);
  assert.equal(transceivers.get("peer-a").sender.track, null);
  const nextTrack = { kind: "audio" };
  await replaceVoiceTracks(transceivers, nextTrack);
  assert.equal(transceivers.get("peer-a").sender.track, nextTrack);
  assert.equal(getOrCreateVoicePeer(peers, "peer-a", () => ({})), peer);
  assert.deepEqual(replaced, [null, nextTrack]);
  assert.equal(peers.size, 1);
  await assert.doesNotReject(replaceVoiceTrack(transceivers.get("peer-a"), null));
});

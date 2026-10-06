"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {fbApp} from "./firebase";
import {activateVoiceTrack,getNegotiatedVoiceTransceiver,getOrCreateVoicePeer,isStaleVoiceSignal,prepareVoiceAnswerTransceiver,removeRemoteVoiceStream,replaceVoiceTrack,replaceVoiceTracks,serializeVoiceDescription,shouldInitiateVoiceOffer,shouldReplaceVoicePeer,upsertRemoteVoiceStream} from "./voiceMesh.cjs";

const iceServers=()=>{
 const urls=(process.env.NEXT_PUBLIC_TURN_URLS||"").split(",").map(value=>value.trim()).filter(Boolean);
 const servers=[{urls:"stun:stun.l.google.com:19302"}];
 if(urls.length)servers.push({urls,username:process.env.NEXT_PUBLIC_TURN_USERNAME,credential:process.env.NEXT_PUBLIC_TURN_CREDENTIAL});
 return servers;
};

export function useVoiceRoom(code,selfId,members,backend,setPresence){
 const [enabled,setEnabled]=useState(false),[muted,setMuted]=useState(true),[status,setStatus]=useState("disconnected"),[error,setError]=useState(""),[streams,setStreams]=useState([]),[speaking,setSpeaking]=useState(false),[heardBy,setHeardBy]=useState({});
 const streamRef=useRef(),peersRef=useRef(new Map()),transceiversRef=useRef(new Map()),remoteStreamsRef=useRef(new Map()),candidateRef=useRef(new Map()),seenRef=useRef(new Set()),signalRef=useRef(),channelRef=useRef(),analyserRef=useRef(),rafRef=useRef(),lastSpeakingRef=useRef(false),meshActiveRef=useRef(false),meshGenerationRef=useRef(0),meshStartingRef=useRef(null);
 const setPresenceRef=useRef(setPresence);setPresenceRef.current=setPresence;
 const memberIds=(Array.isArray(members)?members:[]).map(member=>member?.id).filter(id=>id!=null&&id!==""&&id!==selfId),memberKey=memberIds.join(",");
 const memberIdsRef=useRef(memberIds);memberIdsRef.current=memberIds;

 const sendSignal=useCallback(async(target,payload)=>{
  if(code==null||code===""||selfId==null||selfId===""||target==null||target==="")return;
  const message={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,from:selfId,to:target,...payload,t:Date.now()};
  if(backend==="firebase"){
   const D=await import("firebase/database"),app=await fbApp();await D.push(D.ref(D.getDatabase(app),`rooms/${code}/signals/${target}`),message);
  }else if(backend==="firestore"){
   const F=await import("firebase/firestore"),app=await fbApp(),db=F.getFirestore(app);
   await F.addDoc(F.collection(db,"rooms",code,"signals",target,"events"),message);
  }else channelRef.current?.postMessage({type:"signal",...message});
 },[backend,code,selfId]);

 const updateMeshStatus=useCallback(()=>{
  if(!meshActiveRef.current){setStatus("disconnected");return}
  const states=Array.from(peersRef.current.values(),peer=>peer.connectionState);
  if(!states.length||states.includes("connected"))setStatus("connected");
  else if(states.some(state=>state==="new"||state==="connecting"||state==="checking"||state==="disconnected"))setStatus("connecting");
  else setStatus("disconnected");
 },[]);

 const addPeer=useCallback(async(peerId,initiator=false)=>{
  const existing=peersRef.current.get(peerId);
  if(existing)return existing;
  const peer=getOrCreateVoicePeer(peersRef.current,peerId,()=>new RTCPeerConnection({iceServers:iceServers()}));
  if(!peer)return null;
  const transceiver=initiator?peer.addTransceiver("audio",{direction:"sendrecv"}):null;
  if(transceiver)transceiversRef.current.set(peerId,transceiver);
  console.info("[voice-debug] peer-created",peerId);
  const track=streamRef.current?.getAudioTracks()[0];
  if(track&&transceiver){
   const sender=await replaceVoiceTrack(transceiver,track);
   console.info("[voice-debug] replace-track",{
    peerId,
    hasSenderTrack:!!sender.track,
    enabled:sender.track?.enabled,
    readyState:sender.track?.readyState
   });
  }
  peer.onicecandidate=event=>{
   if(event.candidate){
    console.info("[voice-debug] ice-local",peerId);
    void sendSignal(peerId,{signalType:"candidate",candidate:event.candidate.toJSON()}).catch(exception=>setError(exception.message||"Voice connection signal failed."));
   }
  };
  peer.ontrack=event=>{
   console.info("[voice-debug] remote-track",{
    peerId,
    kind:event.track?.kind,
    readyState:event.track?.readyState,
    muted:event.track?.muted,
    streamCount:event.streams?.length||0
   });
   if(!event.track)return;
   if(event.track.kind==="audio"&&event.transceiver)transceiversRef.current.set(peerId,event.transceiver);
   const incoming=event.streams?.[0]||new MediaStream([event.track]);
   upsertRemoteVoiceStream(remoteStreamsRef.current,peerId,incoming,event.track);
   setStreams(Array.from(remoteStreamsRef.current,([id,stream])=>({id,stream})));
  };
  const logPath=async()=>{
   const stats=await peer.getStats(),reports=Array.from(stats.values());
   const pair=reports.find(report=>report.type==="candidate-pair"&&(report.selected||report.nominated&&report.state==="succeeded"));
   if(!pair)return;
   const local=reports.find(report=>report.type==="local-candidate"&&report.id===pair.localCandidateId);
   const remote=reports.find(report=>report.type==="remote-candidate"&&report.id===pair.remoteCandidateId);
   console.info("[voice-debug] candidate-path",{
    peerId,
    state:pair.state,
    localType:local?.candidateType,
    remoteType:remote?.candidateType
   });
  };
  const logLocalCandidateTypes=async()=>{
   const stats=await peer.getStats(),candidateTypes=[...new Set(Array.from(stats.values())
    .filter(report=>report.type==="local-candidate")
    .map(report=>report.candidateType))];
   console.info("[voice-debug] local-candidate-types",{peerId,candidateTypes});
  };
  const logPeerState=()=>{
   console.info("[voice-debug] connection-state",{
    peerId,
    connectionState:peer.connectionState,
    iceConnectionState:peer.iceConnectionState,
    iceGatheringState:peer.iceGatheringState,
    signalingState:peer.signalingState
   });
  };
  peer.onconnectionstatechange=()=>{
   logPeerState();
   if(peer.connectionState==="connected"){
    for(const item of peer.getTransceivers().filter(value=>value.sender.track?.kind==="audio"||value.receiver.track?.kind==="audio"))console.info("[voice-debug] audio-transceiver",peerId,{
     direction:item.direction,
     currentDirection:item.currentDirection,
     senderHasTrack:!!item.sender.track,
     receiverTrackKind:item.receiver.track?.kind
    });
    void logPath().catch(exception=>console.warn("[voice-debug] candidate-path-unavailable",exception?.name||"error"));
   }
   if(peer.connectionState==="failed")setError("Voice connect nahi ho pa raha, network block ho sakta hai.");
   if(["failed","closed"].includes(peer.connectionState)){
    removeRemoteVoiceStream(remoteStreamsRef.current,peerId);
    setStreams(Array.from(remoteStreamsRef.current,([id,stream])=>({id,stream})));
   }
   updateMeshStatus();
  };
  peer.oniceconnectionstatechange=logPeerState;
  peer.onicegatheringstatechange=()=>{
   logPeerState();
   if(peer.iceGatheringState==="complete")void logLocalCandidateTypes().catch(exception=>console.warn("[voice-debug] candidate-gathering-unavailable",exception?.name||"error"));
  };
  peer.onsignalingstatechange=logPeerState;
  if(initiator){
   const offer=await peer.createOffer();
   console.info("[voice-debug] offer-created",peerId);
   await peer.setLocalDescription(offer);await sendSignal(peerId,{signalType:"offer",description:serializeVoiceDescription(offer)});
  }
  updateMeshStatus();
  return peer;
 },[sendSignal,updateMeshStatus]);

 const closePeer=useCallback(peerId=>{
  const peer=peersRef.current.get(peerId);
  if(peer){
   peer.onicecandidate=null;peer.ontrack=null;peer.onconnectionstatechange=null;
   peer.oniceconnectionstatechange=null;peer.onicegatheringstatechange=null;
   peer.onsignalingstatechange=null;peer.close()
  }
  peersRef.current.delete(peerId);transceiversRef.current.delete(peerId);candidateRef.current.delete(peerId);
  removeRemoteVoiceStream(remoteStreamsRef.current,peerId);
  setStreams(Array.from(remoteStreamsRef.current,([id,stream])=>({id,stream})));
  updateMeshStatus();
 },[updateMeshStatus]);

 const handleSignal=useCallback(async message=>{
  if(!message||selfId==null||selfId===""||message.to!==selfId||message.from==null||message.from==="")return;
  if(isStaleVoiceSignal(message)){
   const ageMs=Number.isFinite(Number(message.t))?Date.now()-Number(message.t):Number.NaN;
   console.warn("[voice] dropped stale signal",ageMs);
   return;
  }
  if(seenRef.current.has(message.id))return;seenRef.current.add(message.id);
  if(message.signalType==="heard"){setHeardBy(current=>({...current,[message.from]:Date.now()}));return}
  let peer=peersRef.current.get(message.from);
  if(message.signalType==="offer"&&peer&&shouldReplaceVoicePeer(peer.connectionState)){
   closePeer(message.from);peer=null;
  }
  peer=peer||await addPeer(message.from,false);
  if(!peer)return;
  if(message.signalType==="offer"){
   await peer.setRemoteDescription(message.description);
   const transceiver=prepareVoiceAnswerTransceiver(peer,transceiversRef.current.get(message.from));
   if(transceiver)transceiversRef.current.set(message.from,transceiver);
   const track=streamRef.current?.getAudioTracks()[0];
   if(track&&transceiver)await replaceVoiceTrack(transceiver,track);
   const answer=await peer.createAnswer();
   console.info("[voice-debug] answer-created",message.from);
   await peer.setLocalDescription(answer);await sendSignal(message.from,{signalType:"answer",description:serializeVoiceDescription(answer)});
  }else if(message.signalType==="answer"){
   await peer.setRemoteDescription(message.description);
   const transceiver=getNegotiatedVoiceTransceiver(peer,transceiversRef.current.get(message.from));
   if(transceiver)transceiversRef.current.set(message.from,transceiver);
  }else if(message.signalType==="candidate"){
   console.info("[voice-debug] ice-remote",message.from);
   if(peer.remoteDescription)await peer.addIceCandidate(message.candidate);
   else{const queue=candidateRef.current.get(message.from)||[];queue.push(message.candidate);candidateRef.current.set(message.from,queue)}
  }
  const queued=candidateRef.current.get(message.from)||[];
  if(peer.remoteDescription&&queued.length){for(const candidate of queued)await peer.addIceCandidate(candidate);candidateRef.current.delete(message.from)}
 },[addPeer,closePeer,sendSignal,selfId]);

 const joinMesh=useCallback(async()=>{
  console.info("[voice-debug] voice-init",{
   hasSelfId:selfId!=null&&selfId!=="",
   memberCount:memberIdsRef.current.length,
   hasRoomId:code!=null&&code!==""
  });
  if(code==null||code===""||selfId==null||selfId==="")return;
  console.info("[voice-debug] joinMesh",{
   selfId,
   memberCount:memberIdsRef.current.length,
   memberIds:memberIdsRef.current
  });
  if(meshActiveRef.current){
   await Promise.all(memberIdsRef.current.map(peerId=>addPeer(peerId,shouldInitiateVoiceOffer(selfId,peerId))));
   return;
  }
  if(meshStartingRef.current)return meshStartingRef.current;
  meshActiveRef.current=true;
  const generation=++meshGenerationRef.current;
  setError("");setStatus(memberIdsRef.current.length?"connecting":"connected");
  const receive=message=>{
   console.info("[voice-debug] signal-received",{
    peerId:message?.from,
    type:message?.signalType
   });
   const process=async()=>{
    if(isStaleVoiceSignal(message)){
     const ageMs=Number.isFinite(Number(message.t))?Date.now()-Number(message.t):Number.NaN;
     console.warn("[voice] dropped stale signal",ageMs);
     if(backend==="firebase"&&message.ref){const D=await import("firebase/database");await D.remove(message.ref)}
     else if(backend==="firestore"&&message.ref){const F=await import("firebase/firestore");await F.deleteDoc(message.ref)}
     return;
    }
    try{await handleSignal(message)}
    catch(exception){setError(exception.message||"Voice connection signal failed.")}
    finally{
     if(backend==="firebase"&&message.ref)await import("firebase/database").then(D=>D.remove(message.ref)).catch(exception=>setError(exception.message||"Could not clear a voice signal."));
     else if(backend==="firestore"&&message.ref)await import("firebase/firestore").then(F=>F.deleteDoc(message.ref)).catch(exception=>setError(exception.message||"Could not clear a voice signal."));
    }
   };
   void process().catch(exception=>setError(exception.message||"Could not process a voice signal."));
  };
  const setup=(async()=>{
   if(backend==="firebase"){
    const D=await import("firebase/database"),app=await fbApp(),ref=D.ref(D.getDatabase(app),`rooms/${code}/signals/${selfId}`);
    const unsubscribe=D.onChildAdded(ref,snap=>receive({...snap.val(),id:snap.key,ref:snap.ref}));
    if(!meshActiveRef.current||generation!==meshGenerationRef.current)unsubscribe();else signalRef.current=unsubscribe;
   }else if(backend==="firestore"){
    const F=await import("firebase/firestore"),app=await fbApp(),db=F.getFirestore(app),ref=F.collection(db,"rooms",code,"signals",selfId,"events");
    const unsubscribe=F.onSnapshot(ref,snapshot=>snapshot.docChanges().filter(change=>change.type==="added").forEach(change=>receive({...change.doc.data(),id:change.doc.id,ref:change.doc.ref})));
    if(!meshActiveRef.current||generation!==meshGenerationRef.current)unsubscribe();else signalRef.current=unsubscribe;
   }else{
    const channel=new BroadcastChannel("weebie-voice-"+code);
    channel.onmessage=event=>{if(event.data?.type==="signal")receive(event.data)};
    if(!meshActiveRef.current||generation!==meshGenerationRef.current)channel.close();else channelRef.current=channel;
   }
   if(!meshActiveRef.current||generation!==meshGenerationRef.current)return;
   await Promise.all(memberIdsRef.current.map(peerId=>addPeer(peerId,shouldInitiateVoiceOffer(selfId,peerId))));
   updateMeshStatus();
  })();
  meshStartingRef.current=setup;
  try{await setup}
  catch(exception){if(meshActiveRef.current&&generation===meshGenerationRef.current){setError(exception.message||"Could not join the voice mesh.");setStatus("disconnected")}}
  finally{if(meshStartingRef.current===setup)meshStartingRef.current=null}
 },[addPeer,backend,code,handleSignal,selfId,updateMeshStatus]);

 const leaveMesh=useCallback(()=>{
  meshActiveRef.current=false;meshGenerationRef.current++;meshStartingRef.current=null;
  signalRef.current?.();signalRef.current=null;channelRef.current?.close();channelRef.current=null;
  for(const peerId of peersRef.current.keys())closePeer(peerId);
  peersRef.current.clear();transceiversRef.current.clear();candidateRef.current.clear();seenRef.current.clear();
  remoteStreamsRef.current.clear();setStreams([]);setHeardBy({});setStatus("disconnected");
 },[closePeer]);

 const start=useCallback(async()=>{
  if(!navigator.mediaDevices?.getUserMedia){setError("This browser does not support microphone access.");return}
  let stream,acquired=false;
  try{
   setError("");
   stream=streamRef.current;
   let track=stream?.getAudioTracks()[0];
   if(!track||track.readyState==="ended"){
    stream?.getTracks().forEach(existingTrack=>existingTrack.stop());
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    acquired=true;
    streamRef.current=stream;
    track=stream.getAudioTracks()[0];
    if(!track)throw new Error("Microphone access returned no audio track.");
   }
   track=activateVoiceTrack(track);
   console.info(acquired?"[voice-debug] mic-acquired":"[voice-debug] mic-reused",{
    kind:track.kind,
    enabled:track.enabled,
    muted:track.muted,
    readyState:track.readyState
   });
   for(const [peerId,peer] of peersRef.current){
    const audioTransceivers=peer.getTransceivers().filter(item=>item.sender.track?.kind==="audio"||item.receiver.track?.kind==="audio");
    for(const item of audioTransceivers)console.info("[voice-debug] audio-transceiver",peerId,{
     direction:item.direction,
     currentDirection:item.currentDirection,
     senderHasTrack:!!item.sender.track,
     receiverTrackKind:item.receiver.track?.kind
    });
   }
   await replaceVoiceTracks(transceiversRef.current,track,(peerId,sender,transceiver)=>{
    console.info("[voice-debug] replace-track",{
     peerId,
     hasSenderTrack:!!sender.track,
     enabled:sender.track?.enabled,
     readyState:sender.track?.readyState
    });
    console.info("[voice-debug] audio-transceiver",peerId,{
     direction:transceiver.direction,
     currentDirection:transceiver.currentDirection,
     senderHasTrack:!!transceiver.sender.track,
     receiverTrackKind:transceiver.receiver.track?.kind
    });
   });
   setEnabled(true);setMuted(false);setPresenceRef.current?.({muted:false});
   const AudioContext=window.AudioContext||window.webkitAudioContext;
   if(AudioContext&&!analyserRef.current){
    const context=new AudioContext();await context.resume();
    const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();source.connect(analyser);analyser.fftSize=512;analyserRef.current={context,source,analyser};
    const data=new Uint8Array(analyser.frequencyBinCount);
    const detect=()=>{analyser.getByteFrequencyData(data);const active=data.reduce((sum,value)=>sum+value,0)/data.length>12&&!track.muted;setSpeaking(active);if(active!==lastSpeakingRef.current){lastSpeakingRef.current=active;setPresenceRef.current?.({speaking:active})}rafRef.current=requestAnimationFrame(detect)};
    detect();
   }
  }catch(exception){
   stream?.getTracks().forEach(track=>track.stop());streamRef.current=null;
   await replaceVoiceTracks(transceiversRef.current,null).catch(replacementError=>setError(replacementError.message||"Could not detach the microphone."));
   setError(exception.name==="NotAllowedError"?"Microphone permission was denied. Allow microphone access and try again.":exception.message||"Could not start the microphone.");
   setEnabled(false);setMuted(true);
  }
 },[]);

 const stop=useCallback(async()=>{
  const stream=streamRef.current;streamRef.current=null;
  const replacements=await Promise.allSettled(Array.from(transceiversRef.current,async([peerId,transceiver])=>{
    const sender=await replaceVoiceTrack(transceiver,null);
    console.info("[voice-debug] replace-track",{
     peerId,
     hasSenderTrack:!!sender.track,
     enabled:sender.track?.enabled,
     readyState:sender.track?.readyState
    });
  }));
  const detachFailure=replacements.find(result=>result.status==="rejected");
  if(detachFailure)setError(detachFailure.reason?.message||"Could not detach the microphone.");
  stream?.getTracks().forEach(track=>track.stop());
  const analyser=analyserRef.current;analyserRef.current=null;
  analyser?.source.disconnect();analyser?.analyser.disconnect();void analyser?.context.close();
  cancelAnimationFrame(rafRef.current);setSpeaking(false);lastSpeakingRef.current=false;
  setEnabled(false);setMuted(true);setPresenceRef.current?.({muted:true,speaking:false});updateMeshStatus();
 },[updateMeshStatus]);

 useEffect(()=>{
  if(!meshActiveRef.current)return;
  console.info("[voice-debug] members-updated",{
   selfId,
   memberCount:memberIds.length,
   memberIds
  });
  const currentIds=new Set(memberIds);
  for(const peerId of peersRef.current.keys())if(!currentIds.has(peerId))closePeer(peerId);
  void Promise.all(memberIds.map(peerId=>addPeer(peerId,shouldInitiateVoiceOffer(selfId,peerId)))).catch(exception=>setError(exception.message||"Could not update voice connections."));
 },[memberKey,addPeer,closePeer,selfId]);

 useEffect(()=>()=>{void stop();leaveMesh()},[leaveMesh,stop]);
 const confirmHear=useCallback(target=>sendSignal(target,{signalType:"heard"}),[sendSignal]);
 return {enabled,muted,status,error,streams,speaking,heardBy,start,stop,joinMesh,confirmHear};
}

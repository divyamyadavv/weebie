"use client";
import {createPortal} from "react-dom";
import {useEffect,useRef,useState} from "react";
import {Mic,MicOff,Volume2} from "lucide-react";
import {useVoiceRoom} from "../lib/voice";

export default function VoiceChat({code,selfId,members,backend,setPresence,micDisabled,miniSlot}){
 const safeMembers=Array.isArray(members)?members:[];
 const voice=useVoiceRoom(code,selfId,safeMembers,backend,setPresence);
 const audioElements=useRef(new Map()),audioCallbacks=useRef(new Map()),[needsTap,setNeedsTap]=useState(false);
 const heardNames=safeMembers.filter(member=>member?.id!=null&&voice.heardBy[member.id]).map(member=>member.name);
 const audioRefFor=(id,stream)=>{
  let callback=audioCallbacks.current.get(id);
  if(!callback){
   const ref=node=>{
    if(!node){audioElements.current.delete(id);audioCallbacks.current.delete(id);return}
    audioElements.current.set(id,node);node.srcObject=stream;node.muted=false;node.volume=1;
    console.info("[voice-debug] audio-attached",{
     peerId:id,
     hasSrcObject:!!node.srcObject,
     trackCount:node.srcObject?.getTracks?.().length
    });
    node.play().then(()=>{
     console.info("[voice-debug] audio-playing",id);
     console.info("[voice-debug] audio-state",{
      peerId:id,
      muted:node.muted,
      volume:node.volume,
      paused:node.paused,
      readyState:node.readyState,
      trackCount:node.srcObject?.getTracks?.().length,
      tracks:node.srcObject?.getTracks?.().map(track=>({
       kind:track.kind,
       enabled:track.enabled,
       muted:track.muted,
       readyState:track.readyState
      }))
     });
    },error=>{
     console.warn("[voice-debug] audio-play-blocked",{
      peerId:id,
      errorName:error?.name
     });
     setNeedsTap(true);
    });
   };
   callback=ref;audioCallbacks.current.set(id,callback);
  }
  return callback;
 };
 useEffect(()=>{void voice.joinMesh()},[voice.joinMesh]);
 useEffect(()=>{if(micDisabled&&voice.enabled)voice.stop()},[micDisabled,voice.enabled]);
 useEffect(()=>{setPresence?.({voiceStatus:voice.status})},[voice.status]);
 useEffect(()=>{voice.streams.forEach(item=>{
  const audio=audioElements.current.get(item.id);if(!audio)return;
  if(audio.srcObject!==item.stream){
   audio.srcObject=item.stream;
   console.info("[voice-debug] audio-attached",{
    peerId:item.id,
    hasSrcObject:!!audio.srcObject,
    trackCount:audio.srcObject?.getTracks?.().length
   });
  }
  audio.muted=false;audio.volume=1;
  audio.play().then(()=>{
   console.info("[voice-debug] audio-playing",item.id);
   console.info("[voice-debug] audio-state",{
    peerId:item.id,
    muted:audio.muted,
    volume:audio.volume,
    paused:audio.paused,
    readyState:audio.readyState,
    trackCount:audio.srcObject?.getTracks?.().length,
    tracks:audio.srcObject?.getTracks?.().map(track=>({
     kind:track.kind,
     enabled:track.enabled,
     muted:track.muted,
     readyState:track.readyState
    }))
   });
  },error=>{
   console.warn("[voice-debug] audio-play-blocked",{
    peerId:item.id,
    errorName:error?.name
   });
   setNeedsTap(true);
  });
 })},[voice.streams]);
 const playAllRemoteAudio=async()=>{
  const results=await Promise.all(Array.from(audioElements.current.entries(),([peerId,audio])=>audio.play().then(()=>{
   console.info("[voice-debug] audio-playing",peerId);
   return true;
  },error=>{
   console.warn("[voice-debug] audio-play-blocked",{
    peerId,
    errorName:error?.name
   });
   return false;
  })));
  setNeedsTap(results.some(result=>!result));
 };
 const toggleMicrophone=()=>{if(micDisabled)return;if(!voice.enabled)return voice.start();return voice.stop()};
 return <><div className="space-y-2 border-t border-white/10 p-3">
  <div className="flex items-center gap-2"><Volume2 size={14} className="text-violet-300"/><span className="text-xs font-semibold">Voice</span><span className={`ml-auto text-[11px] ${voice.status==="connected"?"text-emerald-300":"text-slate-500"}`}>{voice.enabled?"Live":voice.status==="connected"?"Listening":voice.status}</span></div>
  <div className="flex gap-2">
    <button onClick={toggleMicrophone} disabled={micDisabled} className={`btn flex-1 !py-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${voice.muted||!voice.enabled?"bg-red-600":""}`} aria-label={micDisabled?"Microphone disabled by admin":voice.enabled&&!voice.muted?"Turn microphone off":"Turn microphone on"}>{voice.enabled&&!voice.muted?<Mic size={15}/>:<MicOff size={15}/>}<span>{micDisabled?"Mic disabled":voice.enabled&&!voice.muted?"Microphone on":"Microphone off"}</span></button>
  </div>
    {voice.enabled&&<p className="text-[11px] text-slate-400">{voice.muted?"Microphone muted":"Microphone active"}{voice.speaking&&!voice.muted?" · Speaking":""}{heardNames.length?` · ${heardNames.join(", ")} can hear you`:""}</p>}
    {voice.streams.map(item=><div key={item.id} className="flex items-center gap-2"><audio autoPlay playsInline muted={false} ref={audioRefFor(item.id,item.stream)}/><button onClick={()=>voice.confirmHear(item.id)} className="text-violet-300 hover:text-white">I can hear you</button></div>)}
    {needsTap&&voice.streams.length>0&&<button type="button" onClick={playAllRemoteAudio} className="btn2 !py-1.5 text-xs">Tap to hear</button>}
  {voice.error&&<p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">{voice.error}</p>}
  {backend==="demo"&&<p className="text-[11px] text-slate-500">Demo voice works between tabs in this browser. Firebase is required across devices.</p>}
 </div>{miniSlot&&createPortal(<button type="button" onClick={toggleMicrophone} disabled={micDisabled} className={`grid h-10 w-10 place-items-center rounded-lg border border-white/15 bg-black/75 text-white shadow-lg hover:bg-violet-950 disabled:cursor-not-allowed disabled:opacity-50 ${voice.enabled&&!voice.muted?"text-emerald-300":""}`} aria-label={micDisabled?"Microphone disabled by admin":voice.enabled&&!voice.muted?"Turn microphone off":"Turn microphone on"} title={micDisabled?"Microphone disabled by admin":voice.enabled&&!voice.muted?"Turn microphone off":"Turn microphone on"}>{voice.enabled&&!voice.muted?<Mic size={17}/>:<MicOff size={17}/>}</button>,miniSlot)}</>;
}

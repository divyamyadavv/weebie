"use client";
import {useEffect} from "react";
import {Mic,MicOff,Volume2} from "lucide-react";
import {useVoiceRoom} from "../lib/voice";

export default function VoiceChat({code,selfId,members,backend,setPresence,micDisabled}){
 const voice=useVoiceRoom(code,selfId,members,backend,setPresence);
 const heardNames=members.filter(member=>voice.heardBy[member.id]).map(member=>member.name);
 useEffect(()=>{if(micDisabled&&voice.enabled)voice.stop()},[micDisabled,voice.enabled]);
 useEffect(()=>{setPresence?.({voiceStatus:voice.status})},[voice.status]);
 const toggleMicrophone=()=>{if(micDisabled)return;if(!voice.enabled)return voice.start();voice.toggleMute()};
 return <div className="space-y-2 border-t border-white/10 p-3">
  <div className="flex items-center gap-2"><Volume2 size={14} className="text-violet-300"/><span className="text-xs font-semibold">Voice</span><span className={`ml-auto text-[11px] ${voice.status==="connected"?"text-emerald-300":"text-slate-500"}`}>{voice.status}</span></div>
  <div className="flex gap-2">
    <button onClick={toggleMicrophone} disabled={micDisabled} className={`btn flex-1 !py-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${voice.muted||!voice.enabled?"bg-red-600":""}`} aria-label={micDisabled?"Microphone disabled by admin":voice.enabled&&!voice.muted?"Turn microphone off":"Turn microphone on"}>{voice.enabled&&!voice.muted?<Mic size={15}/>:<MicOff size={15}/>}<span>{micDisabled?"Mic disabled":voice.enabled&&!voice.muted?"Microphone on":"Microphone off"}</span></button>
  </div>
    {voice.enabled&&<div className="space-y-1 text-[11px] text-slate-400"><p>{voice.muted?"Microphone muted":"Microphone active"}{voice.speaking&&!voice.muted?" · Speaking":""}{heardNames.length?` · ${heardNames.join(", ")} can hear you`:""}</p>{voice.streams.map(item=><div key={item.id} className="flex items-center gap-2"><audio autoPlay muted={members.find(member=>member.id===item.id)?.roomMuted===true} ref={node=>{if(node)node.srcObject=item.stream}}/><button onClick={()=>voice.confirmHear(item.id)} className="text-violet-300 hover:text-white">I can hear you</button></div>)}</div>}
  {voice.error&&<p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">{voice.error}</p>}
  {backend==="demo"&&<p className="text-[11px] text-slate-500">Demo voice works between tabs in this browser. Firebase is required across devices.</p>}
 </div>;
}

"use client";
import {useState} from "react";
import {UserRound, Crown, UserPlus, UserX, MicOff, VolumeX, Ban, Flag} from "lucide-react";

const actions=[
 {id:"profile",label:"View Profile",icon:UserRound},
 {id:"leadership",label:"Give Leadership",icon:Crown,admin:true,sensitive:true},
 {id:"friend",label:"Send Friend Request",icon:UserPlus},
 {id:"kick",label:"Kick from Room",icon:UserX,admin:true,sensitive:true},
 {id:"disableMic",label:"Disable Mic",icon:MicOff,admin:true,sensitive:true},
 {id:"mute",label:"Mute Member",icon:VolumeX,admin:true,sensitive:true},
 {id:"block",label:"Block Member",icon:Ban,sensitive:true},
 {id:"report",label:"Report Member",icon:Flag}
];

export default function MemberActions({member,isAdmin,onClose,onAction}){
 const [profile,setProfile]=useState(false);
 const available=actions.filter(action=>!action.admin||isAdmin).map(action=>action.id==="disableMic"&&member.micDisabled?{...action,id:"enableMic",label:"Enable Mic",sensitive:false}:action.id==="mute"&&member.roomMuted?{...action,id:"unmute",label:"Unmute Member",sensitive:false}:action);
 const choose=action=>{if(action.id==="profile")return setProfile(true);if(action.sensitive&&!window.confirm(`${action.label} ${member.name}?`))return;onAction(action.id);onClose()};
 return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 md:items-center" onClick={onClose}>
  <div role="dialog" aria-label={`Actions for ${member.name}`} className="w-full max-w-sm rounded-2xl border border-white/10 bg-panel p-3 shadow-2xl" onClick={event=>event.stopPropagation()}>
   <div className="mb-2 flex items-center gap-3 border-b border-white/10 px-2 pb-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 font-bold">{member.name?.[0]?.toUpperCase()}</span><div><p className="text-sm font-semibold">{member.name}</p><p className="text-xs text-slate-400">{member.admin?"Admin":"Room member"}</p></div></div>
    {profile?<div className="space-y-3 p-2"><p className="text-sm text-slate-300">{member.name} is currently {member.admin?"the room Admin":"a room member"}.</p><p className="text-xs text-slate-500">{member.online?"Online":"Offline"}{member.micDisabled?" · Mic disabled":""}{member.roomMuted?" · Muted for you":""}</p><button onClick={()=>setProfile(false)} className="btn2 w-full !py-2">Back</button></div>:<div className="grid gap-1">{available.map(action=>{const Icon=action.icon;return <button key={action.id} onClick={()=>choose(action)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-white/10"><Icon size={16} className={action.sensitive?"text-amber-300":"text-violet-300"}/>{action.label}</button>})}</div>}
  </div>
 </div>;
}

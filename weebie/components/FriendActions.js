"use client";
import {useState} from "react";
import {Avatar} from "./ui";
import {Ban,MessageCircle,Trash2,UserRound,UsersRound,X} from "lucide-react";

export default function FriendActions({friend,activeRoom,onClose,onMessage,onDelete,onBlock,onInvite}){
 const [profile,setProfile]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const run=async(action)=>{
  if((action==="delete"||action==="block")&&!window.confirm(`${action==="delete"?"Delete":"Block"} ${friend.name||"this friend"}?`))return;
  setBusy(true);setError("");
  try{if(action==="message")onMessage();else if(action==="delete")await onDelete();else if(action==="block")await onBlock();else await onInvite(activeRoom.code);onClose()}
  catch(exception){setError(exception.message||"Could not complete this action.")}
  finally{setBusy(false)}
 };
 return <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/60 p-3 md:items-center" onClick={onClose}>
  <section role="dialog" aria-label={`Actions for ${friend.name||"friend"}`} className="w-full max-w-sm rounded-2xl border border-white/10 bg-panel p-4 shadow-2xl" onClick={event=>event.stopPropagation()}>
   <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3"><Avatar name={friend.name||"Weebie"} photoURL={friend.photoURL} size="h-11 w-11"/><div className="min-w-0"><p className="truncate text-sm font-semibold">{friend.name||"Weebie"}</p><p className="text-xs text-slate-400">{friend.username?`@${friend.username}`:friend.online?"Online":"Offline"}</p></div><button type="button" className="ml-auto rounded-lg p-2 text-slate-400 hover:bg-white/10" aria-label="Close friend actions" onClick={onClose}><X size={17}/></button></div>
   {error&&<p role="alert" className="mb-2 rounded-lg bg-red-500/10 p-2 text-xs text-red-200">{error}</p>}
   {profile?<div className="space-y-3"><p className="text-sm text-slate-300"><b>{friend.name||"Weebie"}</b> profile</p><p className="text-xs text-slate-400">{friend.username?`Username: @${friend.username}`:"No username is available for this account."}</p><p className="text-xs text-slate-400">Currently {friend.online?"Online":"Offline"}</p><button type="button" onClick={()=>setProfile(false)} className="btn2 w-full justify-center">Back to actions</button></div>:<div className="grid gap-1">
    <button type="button" disabled={busy} onClick={()=>setProfile(true)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10"><UserRound size={16} className="text-violet-300"/>View Profile</button>
    <button type="button" disabled={busy} onClick={()=>void run("message")} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10"><MessageCircle size={16} className="text-violet-300"/>Message</button>
    {activeRoom&&<button type="button" disabled={busy} onClick={()=>void run("invite")} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-white/10"><UsersRound size={16} className="text-violet-300"/>Invite to {activeRoom.name}</button>}
    <button type="button" disabled={busy} onClick={()=>void run("delete")} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-amber-200 hover:bg-white/10"><Trash2 size={16}/>Delete Friend</button>
    <button type="button" disabled={busy} onClick={()=>void run("block")} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-red-300 hover:bg-white/10"><Ban size={16}/>Block</button>
   </div>}
  </section>
 </div>;
}

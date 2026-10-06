"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Bell,Check,X} from "lucide-react";
import {Avatar} from "./ui";
import {useFriends} from "../lib/friends";
import {claimNextFriendRequestPopup} from "../lib/friendRequestUi.cjs";
import {usePreferences} from "../lib/preferences";
import {popupsAllowed} from "../lib/preferences.cjs";

export default function FriendRequests(){
 const {uid,incoming,accept,decline,error}=useFriends(),{preferences}=usePreferences(uid),popupEnabled=popupsAllowed(preferences,"friendRequest"),[busy,setBusy]=useState(false),[actionError,setActionError]=useState(""),[open,setOpen]=useState(false),[activeId,setActiveId]=useState(null),activeIdRef=useRef(null);
 const claimNext=useCallback((skipId=null)=>{
  if(typeof window==="undefined"||activeIdRef.current||!popupEnabled)return;
  const next=claimNextFriendRequestPopup(incoming,window.localStorage,skipId);
  activeIdRef.current=next?.id||null;setActiveId(next?.id||null);
 },[incoming,popupEnabled]);
 useEffect(()=>{
  if(activeId&&(!popupEnabled||!incoming.some(item=>item.id===activeId))){activeIdRef.current=null;setActiveId(null);return}
  if(!activeIdRef.current)claimNext();
 },[activeId,incoming,claimNext,popupEnabled]);
 const request=incoming.find(item=>item.id===activeId);
 const respond=async(item,action)=>{setBusy(true);setActionError("");try{await (action==="accept"?accept(item):decline(item));activeIdRef.current=null;setActiveId(null)}catch(exception){setActionError(exception.message||"Could not update the friend request.")}finally{setBusy(false)}};
 const decideLater=()=>{const dismissedId=activeId;activeIdRef.current=null;setActiveId(null);claimNext(dismissedId)};
 if(!uid)return null;
 return <>
  <button type="button" onClick={()=>setOpen(value=>!value)} aria-label={`Friend requests${incoming.length?`, ${incoming.length} pending`:""}`} aria-expanded={open} className="fixed right-3 top-3 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-panel text-slate-200 shadow-xl transition hover:bg-violet-600/70 hover:text-white"><Bell size={18}/>{incoming.length>0&&<span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{incoming.length>99?"99+":incoming.length}</span>}</button>
  {open&&<div className="fixed inset-0 z-[60] flex items-start justify-end bg-black/55 p-3 pt-16" onClick={()=>setOpen(false)}><section role="dialog" aria-label="Pending friend requests" className="max-h-[min(70vh,540px)] w-full overflow-y-auto rounded-xl border border-white/10 bg-panel p-4 shadow-2xl md:mr-3 md:w-[min(100%,380px)]" onClick={event=>event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Friend requests {incoming.length>0&&<span className="text-rose-300">({incoming.length})</span>}</h2><button type="button" aria-label="Close requests" onClick={()=>setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X size={16}/></button></div>{error&&<p role="alert" className="mb-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">{error}</p>}{actionError&&<p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-200">{actionError}</p>}{incoming.length?incoming.map(item=><div key={item.id} className="flex items-center gap-3 border-t border-white/10 py-3"><Avatar name={item.senderDisplayName||"Weebie"} photoURL={item.senderPhotoURL} size="h-10 w-10"/><div className="min-w-0 flex-1"><p className="text-sm"><b>{item.senderDisplayName||"A Weebie user"}</b> sent you a friend request</p>{item.senderUsername&&<p className="text-xs text-slate-400">@{item.senderUsername}</p>}<div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={()=>respond(item,"accept")} className="btn !py-1.5 text-xs"><Check size={13}/>Accept</button><button type="button" disabled={busy} onClick={()=>respond(item,"reject")} className="btn2 !py-1.5 text-xs">Decline</button></div></div></div>):<p className="py-5 text-center text-sm text-slate-500">No pending friend requests.</p>}</section></div>}
  {request&&!open&&<section role="dialog" aria-label="Friend request" aria-live="polite" className="fixed right-4 top-16 z-50 w-[calc(100vw-2rem)] max-w-[360px] rounded-xl border border-violet-400/30 bg-panel p-4 shadow-2xl"><div className="flex items-start gap-3"><Avatar name={request.senderDisplayName||"Weebie"} photoURL={request.senderPhotoURL}/><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Friend request</p><p className="mt-1 text-xs text-slate-300"><b>{request.senderDisplayName||"A Weebie user"}</b> sent you a friend request</p>{request.senderUsername&&<p className="mt-1 text-xs text-slate-400">@{request.senderUsername}</p>}</div><button type="button" onClick={decideLater} className="text-slate-500 hover:text-white" aria-label="Decide later"><X size={15}/></button></div>{actionError&&<p role="alert" className="mt-2 text-xs text-red-300">{actionError}</p>}<div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={()=>respond(request,"accept")} disabled={busy} className="btn flex-1 !py-2"><Check size={14}/>Accept</button><button type="button" onClick={()=>respond(request,"reject")} disabled={busy} className="btn2 flex-1 !py-2">Decline</button><button type="button" onClick={decideLater} disabled={busy} className="btn2 !flex-1 !py-2">Decide later</button></div></section>}
 </>;
}

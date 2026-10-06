"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {Check,DoorOpen,UsersRound,X} from "lucide-react";
import {Avatar} from "./ui";
import {callFriendApi} from "../lib/friendApiClient";
import {fbApp} from "../lib/firebase";
import {useFriends} from "../lib/friends";
import {claimNextFriendRequestPopup} from "../lib/friendRequestUi.cjs";
import {usePreferences} from "../lib/preferences";
import {popupsAllowed} from "../lib/preferences.cjs";

export default function RoomInvitations(){
 const router=useRouter(),{uid,friends}=useFriends(),{preferences}=usePreferences(uid),popupEnabled=popupsAllowed(preferences,"roomInvite"),[invitations,setInvitations]=useState([]),[activeId,setActiveId]=useState(null),[open,setOpen]=useState(false),[error,setError]=useState(""),[busyId,setBusyId]=useState(null),activeIdRef=useRef(null);
 useEffect(()=>{
  if(!uid)return;
  let dead=false,unsubscribe;
  (async()=>{
   try{
    const app=await fbApp(),F=await import("firebase/firestore"),db=F.getFirestore(app),invites=F.query(F.collection(db,"roomInvitations"),F.where("recipientUid","==",uid));
    if(dead)return;
    unsubscribe=F.onSnapshot(invites,snapshot=>{if(dead)return;setInvitations(snapshot.docs.map(item=>({id:item.id,...item.data()})).filter(item=>item.status==="pending"));setError("")},exception=>{if(dead)return;setError(exception?.code==="permission-denied"?"Firestore denied access to your room invitations.":`Room invitations could not be loaded (${exception?.code||"unknown"}).`)});
   }catch(exception){if(!dead)setError(exception.message||"Room invitations could not be loaded.")}
  })();
  return()=>{dead=true;unsubscribe?.()};
 },[uid]);
 const trustedInvites=invitations.filter(invitation=>friends.some(friend=>friend.id===invitation.senderUid));
 const claimNext=useCallback((skipId=null)=>{
  if(typeof window==="undefined"||!popupEnabled)return;
  if(activeIdRef.current)return;
  const next=claimNextFriendRequestPopup(trustedInvites,window.localStorage,skipId);
  activeIdRef.current=next?.id||null;setActiveId(next?.id||null);
 },[trustedInvites,popupEnabled]);
 useEffect(()=>{
  if(activeId&&(!popupEnabled||!trustedInvites.some(item=>item.id===activeId))){activeIdRef.current=null;setActiveId(null);return}
  if(!activeIdRef.current)claimNext();
 },[activeId,trustedInvites,claimNext,popupEnabled]);
 const invitation=trustedInvites.find(item=>item.id===activeId);
 const respond=async(item,action)=>{
  setBusyId(item.id);setError("");
  try{
   const result=await callFriendApi({operation:"respondInvite",invitationId:item.id,action});
   if(action==="accept"){activeIdRef.current=null;setActiveId(null);setOpen(false);router.push(`/room/${result.data.roomId}`)}
  }catch(exception){setError(exception.message||"Could not update this room invitation.")}
  finally{setBusyId(null)}
 };
 const later=()=>{const dismissed=activeId;activeIdRef.current=null;setActiveId(null);claimNext(dismissed)};
 if(!uid)return null;
 return <>
  {uid&&<button type="button" onClick={()=>setOpen(value=>!value)} aria-label={`Room invitations${trustedInvites.length?`, ${trustedInvites.length} pending`:""}`} aria-expanded={open} className="fixed right-[3.75rem] top-3 z-40 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-panel text-slate-200 shadow-xl transition hover:bg-violet-600/70 hover:text-white"><UsersRound size={18}/>{trustedInvites.length>0&&<span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">{trustedInvites.length>99?"99+":trustedInvites.length}</span>}</button>}
  {open&&<div className="fixed inset-0 z-[60] flex items-start justify-start bg-black/55 p-3 pt-16" onClick={()=>setOpen(false)}><section role="dialog" aria-label="Room invitations" className="max-h-[min(70vh,540px)] w-full overflow-y-auto rounded-xl border border-white/10 bg-panel p-4 shadow-2xl md:ml-3 md:w-[min(100%,380px)]" onClick={event=>event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Room invitations {trustedInvites.length>0&&<span className="text-violet-300">({trustedInvites.length})</span>}</h2><button type="button" aria-label="Close invitations" onClick={()=>setOpen(false)} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X size={16}/></button></div>{error&&<p role="alert" className="mb-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">{error}</p>}{trustedInvites.length?trustedInvites.map(item=>{const friend=friends.find(person=>person.id===item.senderUid);return <div key={item.id} className="flex items-center gap-3 border-t border-white/10 py-3"><Avatar name={friend?.name||item.senderName||"Weebie"} photoURL={friend?.photoURL||item.senderPhotoURL} size="h-9 w-9"/><div className="min-w-0 flex-1"><p className="truncate text-sm"><b>{friend?.name||item.senderName||"A friend"}</b> invited you</p><p className="truncate text-xs text-slate-400">{item.roomName||"Watch Room"}</p></div><button type="button" disabled={!!busyId} onClick={()=>void respond(item,"accept")} aria-label={`Open ${item.roomName||"watch room"}`} className="btn !px-2 !py-1.5"><DoorOpen size={14}/></button><button type="button" disabled={!!busyId} onClick={()=>void respond(item,"decline")} aria-label="Decline room invitation" className="btn2 !px-2 !py-1.5"><X size={14}/></button></div>}):<p className="py-5 text-center text-sm text-slate-500">No pending room invitations.</p>}</section></div>}
  {invitation&&!open&&<section role="dialog" aria-label="Room invitation" aria-live="polite" className="fixed right-4 top-16 z-50 w-[calc(100vw-2rem)] max-w-[360px] rounded-xl border border-violet-400/30 bg-panel p-4 shadow-2xl"><div className="flex items-start gap-3"><Avatar name={invitation.senderName||"Weebie"} photoURL={invitation.senderPhotoURL}/><div className="min-w-0 flex-1"><p className="text-sm font-semibold">Room invitation</p><p className="mt-1 text-xs text-slate-300"><b>{invitation.senderName||"A friend"}</b> invited you to {invitation.roomName||"a watch party"}.</p></div><button type="button" onClick={later} aria-label="Decide later" className="text-slate-500 hover:text-white"><X size={15}/></button></div>{error&&<p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}<div className="mt-3 flex gap-2"><button type="button" disabled={!!busyId} onClick={()=>void respond(invitation,"accept")} className="btn flex-1 !py-2"><Check size={14}/>Open room</button><button type="button" disabled={!!busyId} onClick={()=>void respond(invitation,"decline")} className="btn2 flex-1 !py-2">Decline</button><button type="button" disabled={!!busyId} onClick={later} className="btn2 !py-2">Later</button></div></section>}
 </>;
}

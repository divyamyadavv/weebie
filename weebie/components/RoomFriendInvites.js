"use client";
import {useEffect,useMemo,useState} from "react";
import {Avatar} from "./ui";
import {Check,UsersRound,X} from "lucide-react";
import {fbApp} from "../lib/firebase";
import {roomInviteStatus,subscribeRoomInvitations} from "../lib/roomInvitations.cjs";

export default function RoomFriendInvites({open,onClose,friends,status,error,onInvite,senderUid,roomId,members=[],memberActivity={}}){
 const [busyId,setBusyId]=useState(null),[pendingInvitations,setPendingInvitations]=useState([]),[invitationsLoading,setInvitationsLoading]=useState(true),[invitationError,setInvitationError]=useState(""),[actionError,setActionError]=useState("");
 const activeMemberUids=useMemo(()=>new Set(members.filter(member=>member.online&&!member.kicked).map(member=>member.id)),[members]);
 useEffect(()=>{
  let stopped=false,unsubscribe=()=>{};
  setPendingInvitations([]);
  setInvitationError("");
  if(!open||!senderUid||!roomId){setInvitationsLoading(false);return()=>{stopped=true}}
  setInvitationsLoading(true);
  void(async()=>{
   try{
    const app=await fbApp();
    const F=await import("firebase/firestore");
    if(stopped)return;
    unsubscribe=subscribeRoomInvitations(F,F.getFirestore(app),senderUid,roomId,{
     onInvitations:items=>{setPendingInvitations(items);setInvitationsLoading(false)},
     onError:exception=>{setInvitationError(exception?.code==="permission-denied"?"Firestore denied access to this room's invitations.":`Room invitations could not be loaded (${exception?.code||"unknown"}).`);setInvitationsLoading(false)}
    });
   }catch(exception){
    if(!stopped){setInvitationError(exception.message||"Room invitations could not be loaded.");setInvitationsLoading(false)}
   }
  })();
  return()=>{stopped=true;unsubscribe()};
 },[open,senderUid,roomId]);
 if(!open)return null;
 const invite=async friend=>{
  setBusyId(friend.id);setActionError("");
  try{
   const result=await onInvite(friend);
   if(["pending","sent"].includes(result?.data?.status))setPendingInvitations(current=>current.some(item=>item.recipientUid===friend.id)?current:[...current,{recipientUid:friend.id,roomId,status:"pending"}]);
  }
  catch(exception){setActionError(exception.message||"Could not invite this friend.")}
  finally{setBusyId(null)}
 };
 return <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/60 p-3 md:items-center" onClick={onClose}><section role="dialog" aria-modal="true" aria-label="Invite friends to this room" className="max-h-[min(80vh,620px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-panel p-4 shadow-2xl" onClick={event=>event.stopPropagation()}>
  <header className="mb-3 flex items-center justify-between"><div><h2 className="text-base font-semibold">Invite friends</h2><p className="text-xs text-slate-400">Only accepted, unblocked friends can be invited.</p></div><button type="button" onClick={onClose} aria-label="Close invitations" className="rounded-lg p-2 text-slate-400 hover:bg-white/10"><X size={17}/></button></header>
  {error&&<p role="alert" className="mb-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">{error}</p>}{invitationError&&<p role="alert" className="mb-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">{invitationError}</p>}{actionError&&<p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-200">{actionError}</p>}
  {status==="loading"?<p className="py-8 text-center text-sm text-slate-400">Loading friends…</p>:status==="error"?<p className="py-8 text-center text-sm text-slate-400">Friends could not be loaded.</p>:friends.length?friends.map(friend=>{
   const inviteStatus=roomInviteStatus(friend.id,activeMemberUids,pendingInvitations,memberActivity),isInvited=inviteStatus==="invited",isMember=inviteStatus==="member";
   return <div key={friend.id} className="flex items-center gap-3 border-t border-white/10 py-3"><Avatar name={friend.name||"Weebie"} photoURL={friend.photoURL}/><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{friend.name||"Weebie"}</p><p className={`text-xs ${friend.online?"text-emerald-300":"text-slate-500"}`}>{friend.online?"Online":"Offline"}</p></div><button type="button" disabled={busyId===friend.id||isInvited||isMember||invitationsLoading} onClick={()=>void invite(friend)} className={isInvited||isMember?"btn2 !py-1.5 text-xs":"btn !py-1.5 text-xs"}>{isMember?<><Check size={13}/>In room</>:isInvited?<><Check size={13}/>Invited</>:<><UsersRound size={13}/>{busyId===friend.id?"Sending…":invitationsLoading?"Checking…":"Invite"}</>}</button></div>
  }):<p className="py-8 text-center text-sm text-slate-500">Add friends to invite them to a watch party.</p>}
 </section></div>;
}

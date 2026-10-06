"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {Clock,MoreVertical,UserPlus,Users} from "lucide-react";
import {Avatar} from "../../components/ui";
import FriendActions from "../../components/FriendActions";
import Shell from "../../components/Shell";
import {useFriends} from "../../lib/friends";
import {getMyActiveFirestoreRoom} from "../../lib/firestoreRooms";

export default function Friends(){
 const router=useRouter(),{uid,friends,friendsStatus,incoming,outgoing,error,deleteFriend,blockFriend,callFriendApi}=useFriends(),[activeRoom,setActiveRoom]=useState(null),[selectedFriend,setSelectedFriend]=useState(null),[actionMessage,setActionMessage]=useState(""),[roomError,setRoomError]=useState(""),longPress=useRef(null),suppressClick=useRef(false);
 useEffect(()=>{let active=true;if(!uid)return()=>{active=false};getMyActiveFirestoreRoom().then(room=>{if(active)setActiveRoom(room)}).catch(exception=>{if(active)setRoomError(exception.message||"Your active room could not be checked.")});return()=>{active=false}},[uid]);
 const invite=async(friendUid,roomCode)=>{const result=await callFriendApi({operation:"invite",friendUid,roomId:roomCode});setActionMessage(result.data?.status==="pending"?"An invitation is already pending.":"Room invitation sent.");setTimeout(()=>setActionMessage(""),3000)};
 const longPressStart=(event,friend)=>{if(event.pointerType!=="touch")return;clearTimeout(longPress.current);longPress.current=setTimeout(()=>{suppressClick.current=true;setSelectedFriend(friend)},550)};
 const longPressStop=()=>clearTimeout(longPress.current);
 const onFriendClick=event=>{if(suppressClick.current){event.preventDefault();suppressClick.current=false}};
 const pendingOutgoing=outgoing.filter(request=>request.status==="pending");
 return <Shell><div className="mx-auto max-w-3xl space-y-5"><div className="flex items-center justify-between"><div><h1 className="text-xl font-bold">Friends</h1><p className="text-sm text-slate-400">Your accepted watch-party friends</p></div><Link href="/rooms" className="btn2"><Users size={16}/>My Rooms</Link></div>
  {(error||roomError)&&<p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">{error||roomError}</p>}{actionMessage&&<p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-200">{actionMessage}</p>}
  <section className="card p-4"><h2 className="mb-3 text-sm font-semibold">Friends{friendsStatus==="ready"?` (${friends.length})`:""}</h2>{friendsStatus==="ready"?(friends.length?<div className="space-y-2">{friends.map(friend=><div key={friend.id} onPointerDown={event=>longPressStart(event,friend)} onPointerUp={longPressStop} onPointerCancel={longPressStop} onPointerMove={longPressStop} onContextMenu={event=>{event.preventDefault();setSelectedFriend(friend)}} className="flex items-center gap-3 rounded-xl bg-white/5 p-3 transition hover:bg-white/10">
    <Link href={`/friends/${friend.id}`} onClick={onFriendClick} className="flex min-w-0 flex-1 items-center gap-3"><Avatar name={friend.name||"Weebie"} photoURL={friend.photoURL}/><span className="min-w-0"><b className="block truncate text-sm">{friend.name||"Weebie"}</b><span className="block truncate text-xs text-slate-400">{friend.username?`@${friend.username} · `:""}<span className={friend.online?"text-emerald-300":"text-slate-500"}>{friend.online?"Online":"Offline"}</span></span></span></Link>
    <button type="button" aria-label={`More actions for ${friend.name||"friend"}`} onClick={()=>setSelectedFriend(friend)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"><MoreVertical size={18}/><span className="sr-only">More actions</span></button>
   </div>)}</div>:<p className="text-sm text-slate-500">No accepted friends yet.</p>):<p className="text-sm text-slate-500">{friendsStatus==="error"?"Accepted friends could not be loaded.":"Loading accepted friends..."}</p>}</section>
  <section className="card p-4"><h2 className="mb-3 text-sm font-semibold">Requests</h2>{incoming.map(request=><p key={request.id} className="flex items-center gap-2 text-xs text-slate-300"><Clock size={14} className="text-amber-300"/>{request.senderDisplayName||"A Weebie user"} is waiting for your response.</p>)}{pendingOutgoing.map(request=><p key={request.id} className="mt-2 flex items-center gap-2 text-xs text-slate-400"><UserPlus size={14}/>Request sent to {request.recipientDisplayName||"a Weebie user"}</p>)}{!incoming.length&&!pendingOutgoing.length&&<p className="text-sm text-slate-500">No pending requests.</p>}</section>
  <p className="text-center text-[11px] text-slate-500 md:hidden">Long-press a friend or tap the three-dot button for actions.</p>
 </div>{selectedFriend&&<FriendActions friend={selectedFriend} activeRoom={activeRoom} onClose={()=>setSelectedFriend(null)} onMessage={()=>router.push(`/friends/${selectedFriend.id}`)} onDelete={async()=>{await deleteFriend(selectedFriend.id);setActionMessage("Friend deleted.");setTimeout(()=>setActionMessage(""),3000)}} onBlock={async()=>{await blockFriend(selectedFriend.id);setActionMessage("Friend blocked.");setTimeout(()=>setActionMessage(""),3000)}} onInvite={roomCode=>invite(selectedFriend.id,roomCode)}/>}</Shell>;
}

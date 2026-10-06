"use client";
import {useEffect,useState} from "react";
import Shell from "../../components/Shell";import {Avatar} from "../../components/ui";import {subscribeMyFirestoreRooms} from "../../lib/firestoreRooms";import {useAuth} from "../../components/AuthProvider";
export default function Rooms(){
 const {user,loading}=useAuth(),[tab,setTab]=useState("active"),[rooms,setRooms]=useState([]),[pastRooms,setPastRooms]=useState([]),[error,setError]=useState(""),[status,setStatus]=useState("loading"),[joinError,setJoinError]=useState(""),[joiningRoom,setJoiningRoom]=useState("");
 useEffect(()=>{if(loading)return;if(!user){setRooms([]);setPastRooms([]);setStatus("ready");return}return subscribeMyFirestoreRooms(user,{onRooms:setRooms,onPastRooms:setPastRooms,onError:setError,onStatus:setStatus})},[loading,user]);
 useEffect(()=>{
  const notice=window.sessionStorage.getItem("weebie-room-access-notice");
  if(!notice)return;
  window.sessionStorage.removeItem("weebie-room-access-notice");
  setJoinError(notice);
 },[]);
 const joinRoom=async room=>{
  if(!user||joiningRoom)return;
  setJoiningRoom(room.code);setJoinError("");
  try{
   const token=await user.getIdToken();
   const response=await fetch(`/api/rooms/${encodeURIComponent(room.code)}/access`,{method:"POST",headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
   const result=await response.json().catch(()=>({}));
   if(!response.ok){
    if(result.code==="ROOM_KICKED"){setJoinError(result.error);return}
    throw new Error(result.error||"Could not verify access to this room.");
   }
   window.location.assign(`/room/${room.code}`);
  }catch(exception){setJoinError(exception.message||"Could not verify access to this room.")}
  finally{setJoiningRoom("")}
 };
 const visibleRooms=tab==="active"?rooms:pastRooms;
 const isActive=tab==="active";
 return <Shell><h1 className="mb-4 text-xl font-bold">My Rooms</h1>
 <div className="mb-4 flex gap-2">{["active","past"].map(value=><button key={value} onClick={()=>setTab(value)} className={`rounded-lg px-4 py-1.5 text-sm capitalize ${tab===value?"bg-violet-600":"bg-white/5"}`}>{value} {value==="active"?`(${rooms.length})`:`(${pastRooms.length})`}</button>)}</div>
 <div className="max-w-2xl space-y-3">
  {error&&<p role="alert" className="text-sm text-amber-300">{error}</p>}
  {joinError&&<p role="alert" className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-200">{joinError}</p>}
  {status==="offline"&&<p role="status" className="text-sm text-slate-400">You are offline. Active rooms will refresh when your connection returns.</p>}
  {status==="loading"&&!visibleRooms.length&&<p role="status" className="text-sm text-slate-400">Checking for {isActive?"active":"past"} rooms…</p>}
  {visibleRooms.map(room=>{
   const members=Array.isArray(room.activeMembers)?room.activeMembers:[];
   const shown=members.slice(0,5),overflow=members.length-shown.length;
   return <div key={room.code} className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
   <div className="min-w-0 flex-1"><b className="block truncate text-sm">{room.name}</b><p className="text-xs text-slate-400">{room.code} · {isActive?`${room.members??members.length} active ${(room.members??members.length)===1?"member":"members"}`:"Past room"}</p>
    {isActive&&members.length>0&&<div className="mt-2 flex min-h-8 items-center gap-2" aria-label={`Active members: ${members.map(member=>member.name).join(", ")}`}>
     <div className="flex shrink-0 items-center -space-x-2">{shown.map((member,index)=><Avatar key={`${member.name}-${index}`} name={member.name} photoURL={member.photoURL} size="h-7 w-7 border-2 border-slate-900"/>)}
      {overflow>0&&<span className="grid h-7 w-7 place-items-center rounded-full border-2 border-slate-900 bg-slate-700 text-[10px] font-semibold">+{overflow}</span>}
     </div>
     <span className="min-w-0 truncate text-xs text-slate-400">{shown.map(member=>member.name).join(", ")}{overflow>0?` +${overflow}`:""}</span>
    </div>}
   </div>
   <button type="button" onClick={()=>void joinRoom(room)} disabled={!!joiningRoom} className="btn !py-1.5 text-center disabled:opacity-60">{joiningRoom===room.code?"Checking…":"Join"}</button>
  </div>})}
  {status==="ready"&&!visibleRooms.length&&!error&&<p className="text-sm text-slate-400">{isActive?"No rooms have active members right now.":"No past rooms yet."}</p>}
  {status==="error"&&!rooms.length&&!error&&<p role="alert" className="text-sm text-amber-300">Active rooms could not be loaded.</p>}
 </div></Shell>
}

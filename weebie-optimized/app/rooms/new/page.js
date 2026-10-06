"use client";
import {useState} from "react";import {useRouter} from "next/navigation";
import Shell from "../../../components/Shell";import {createFirestoreRoom,firestoreRoomError} from "../../../lib/firestoreRooms";import {ytId} from "../../../lib/youtube";
export default function New(){const r=useRouter(),[name,setName]=useState(""),[yt,setYt]=useState(""),[err,setErr]=useState(""),[creating,setCreating]=useState(false);
 const go=async e=>{e.preventDefault();if(creating)return;if(!name.trim())return setErr("Please enter a room name.");let source=null;if(yt.trim()){const id=ytId(yt);if(!id)return setErr("Invalid YouTube link.");source={type:"yt",id,url:yt.trim()}}
   setCreating(true);setErr("");try{const code=await createFirestoreRoom({name:name.trim(),source});r.push(`/room/${code}`)}catch(error){setErr(firestoreRoomError(error));setCreating(false)}};
 return <Shell><form onSubmit={go} className="card mx-auto max-w-lg space-y-3 p-6"><h1 className="text-xl font-bold">Create Private Room</h1>
  <input className="input" placeholder="Room name" maxLength={80} value={name} onChange={e=>setName(e.target.value)}/>
  <input className="input" placeholder="YouTube link (optional). Pick a Drive video inside the room." value={yt} onChange={e=>setYt(e.target.value)}/>
    {err&&<p role="alert" className="text-xs text-red-400">{err}</p>}<button disabled={creating} className="btn w-full disabled:opacity-50">{creating?"Creating room...":"Create Room"}</button></form></Shell>}

"use client";
import {useState} from "react";import {useRouter} from "next/navigation";import {Link2} from "lucide-react";
import Shell from "../../components/Shell";
export default function Join(){const r=useRouter(),[v,setV]=useState(""),[err,setErr]=useState("");
 const go=e=>{e.preventDefault();const input=v.trim();let code=input;
    if(/^https?:\/\//i.test(input)){try{const path=new URL(input).pathname;code=path.match(/\/room\/([^/]+)\/?$/i)?.[1]||""}catch{code=""}}
    else code=input.split(/[?#]/,1)[0].split("/").pop();
    code=code.toUpperCase();if(!/^[A-Z0-9]{4,32}$/.test(code))return setErr("Enter a valid Room ID or room invite link.");setErr("");r.push(`/room/${code}`)};
 return <Shell><form onSubmit={go} className="card mx-auto max-w-md space-y-3 p-6"><h1 className="text-xl font-bold">Join a Room</h1><p className="text-sm text-slate-400">Enter the invite code or paste a link</p>
    <input className="input" placeholder="e.g. ABC123 or invite link" value={v} onChange={e=>setV(e.target.value)}/>{err&&<p role="alert" className="text-xs text-red-400">{err}</p>}
  <button className="btn w-full">Join Room</button><p className="text-center text-xs text-slate-500">OR</p><button type="button" onClick={async()=>{try{setV(await navigator.clipboard.readText())}catch{setErr("Clipboard blocked by browser.")}}} className="btn2 w-full"><Link2 size={16}/>Paste Invite Link</button></form></Shell>}

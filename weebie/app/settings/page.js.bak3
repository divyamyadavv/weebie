"use client";
import {useEffect,useState} from "react";import {useRouter} from "next/navigation";
import {ChevronRight,Bell,Shield,Globe,LogOut} from "lucide-react";
import {currentUser,signOutAll,updateDisplayName} from "../../lib/auth";import Shell from "../../components/Shell";import {Avatar} from "../../components/ui";
export default function Settings(){const r=useRouter(),[u,setU]=useState({name:"",email:""}),[edit,setEdit]=useState(false),[msg,setMsg]=useState("");useEffect(()=>{currentUser().then(user=>setU({name:user?.displayName||user?.email?.split("@")[0]||"Account",email:user?.email||""}))},[]);
 const save=async()=>{try{await updateDisplayName(u.name);setEdit(false);setMsg("")}catch(e){setMsg(e.message.replace(/^Firebase: /,""))}};
 const Row=({I,t,v})=><div className="flex items-center gap-3 border-t border-white/10 py-3 text-sm"><I size={16}/><span className="flex-1">{t}</span><span className="text-slate-400">{v}</span><ChevronRight size={14}/></div>;
 return <Shell><div className="mx-auto max-w-2xl space-y-6"><div className="card p-5"><h1 className="mb-4 font-bold">Account Settings</h1>
  <div className="flex items-center gap-4"><Avatar name={u.name} size="h-14 w-14"/><div className="flex-1">{edit?<input className="input" value={u.name} onChange={e=>setU({...u,name:e.target.value})}/>:<b>{u.name}</b>}<p className="text-xs text-slate-400">{u.email}</p></div><button onClick={edit?save:()=>setEdit(true)} className="btn2 !py-1.5">{edit?"Save":"Edit"}</button></div>
    <h2 className="mb-2 mt-5 text-xs text-slate-400">Connected Accounts</h2><div className="flex items-center justify-between rounded-xl bg-white/5 p-3 text-sm"><span>Google — <span className="text-slate-400">Sign in with Google from your account screen</span></span></div>
    {msg&&<p role="alert" className="mt-3 text-xs text-amber-300">{msg}</p>}
  <div className="mt-4"><Row I={Bell} t="Notifications" v=""/><Row I={Shield} t="Privacy" v=""/><Row I={Globe} t="Language" v="English"/></div>
  <button onClick={async()=>{await signOutAll();r.push("/")}} className="mt-3 flex items-center gap-2 text-sm text-red-400"><LogOut size={16}/>Logout</button></div></div></Shell>}

"use client";
import {useEffect,useState} from "react";import Link from "next/link";import {useRouter} from "next/navigation";
import {Mail,Lock,User,Eye,EyeOff} from "lucide-react";
import {requiresEmailVerification,sendPasswordReset,sendVerificationEmail,signIn} from "../lib/auth";import Logo from "./Logo";import {isFirebaseAuthReady} from "../lib/firebase";import {useAuth} from "./AuthProvider";
function InputField({icon:Icon,...props}){return <div className="relative"><Icon size={16} className="absolute left-3.5 top-3.5 text-slate-400"/><input className="input pl-10" {...props}/></div>}
export default function AuthForm({signup}){
 const r=useRouter(),{user,loading,requiresVerification}=useAuth(),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[f,setF]=useState({name:"",email:"",pw:"",confirm:""}),[msg,setMsg]=useState("");
 const destination=()=>{const requested=new URLSearchParams(window.location.search).get("next");return requested?.startsWith("/")&&!requested.startsWith("//")?requested:"/dashboard"};
 useEffect(()=>{if(!loading&&user&&!busy)r.replace(requiresVerification?`/verify-email?next=${encodeURIComponent(destination())}`:destination())},[loading,user,busy,requiresVerification,r]);
 const up=k=>e=>setF(x=>({...x,[k]:e.target.value}));
 const run=async k=>{setMsg("");setBusy(true);try{const authenticated=await signIn(k,{email:f.email,pw:f.pw,name:f.name});if(k==="signup"){const actionUrl=new URL("/verify-email",window.location.origin);actionUrl.searchParams.set("next",destination());try{await sendVerificationEmail(authenticated,actionUrl.toString());r.replace(`/verify-email?sent=1&next=${encodeURIComponent(destination())}`)}catch(error){r.replace(`/verify-email?send=failed&next=${encodeURIComponent(destination())}`);return}}else if(requiresEmailVerification(authenticated))r.replace(`/verify-email?next=${encodeURIComponent(destination())}`);else r.replace(destination())}catch(e){setMsg(e.message.replace(/^Firebase: /,""))}finally{setBusy(false)}};
 const submit=e=>{e.preventDefault();if(!isFirebaseAuthReady)return setMsg("Firebase Authentication is not configured. Add the Firebase web app values from .env.example, then restart the development server.");if(!f.email||!f.pw)return setMsg("Please fill in your email and password.");if(signup&&!f.name.trim())return setMsg("Please enter a username.");if(signup&&f.pw!==f.confirm)return setMsg("Passwords do not match.");run(signup?"signup":"login")};
 const google=()=>{if(!isFirebaseAuthReady)return setMsg("Firebase Authentication is not configured. Add the Firebase web app values from .env.example, then restart the development server.");run("google")};
 const reset=async()=>{if(!isFirebaseAuthReady)return setMsg("Firebase Authentication is not configured.");if(!f.email)return setMsg("Enter your email address first.");setBusy(true);try{await sendPasswordReset(f.email);setMsg("Password reset email sent. Check your inbox.")}catch(e){setMsg(e.message.replace(/^Firebase: /,""))}finally{setBusy(false)}};
 if(loading||(user&&!busy))return <div className="grid min-h-screen place-items-center text-sm text-slate-400">Checking your account...</div>;
 return <div className="grid min-h-screen place-items-center p-4"><form onSubmit={submit} className="card fade w-full max-w-sm space-y-3 p-7 text-center">
  <div className="flex justify-center"><Logo/></div><h1 className="text-xl font-bold">{signup?"Create Your Account":"Welcome Back"}</h1>
  <p className="text-sm text-slate-400">{signup?"Join Weebie and start watching together":"Sign in to continue your watch journey"}</p>
  <button type="button" onClick={google} disabled={busy} className="w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-slate-900 disabled:opacity-50">{signup?"Sign up":"Continue"} with Google</button>
  <p className="text-xs text-slate-500">OR</p>
    {signup&&<InputField icon={User} placeholder="Username" value={f.name} onChange={up("name")}/>} 
    <InputField icon={Mail} type="email" placeholder="Email address" value={f.email} onChange={up("email")}/>
    <div className="relative"><InputField icon={Lock} type={show?"text":"password"} placeholder="Password" value={f.pw} onChange={up("pw")}/><button type="button" onClick={()=>setShow(!show)} className="absolute right-3 top-3.5 text-slate-400" aria-label="Toggle password">{show?<EyeOff size={16}/>:<Eye size={16}/>}</button></div>
  {signup&&<div className="relative"><InputField icon={Lock} type={show?"text":"password"} placeholder="Confirm password" value={f.confirm} onChange={up("confirm")}/></div>}
  {!signup&&<p className="text-right text-xs"><button type="button" onClick={reset} disabled={busy} className="text-violet-400 disabled:opacity-50">Forgot password?</button></p>}
  {msg&&<p role="alert" className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">{msg}</p>}
  {!isFirebaseAuthReady&&<p className="text-xs text-amber-300">Real sign-in needs Firebase web app configuration.</p>}
  <button disabled={busy} className="btn w-full disabled:opacity-50">{busy?"Please wait...":signup?"Create Account":"Sign In"}</button>
  <p className="text-xs text-slate-400">{signup?"Already have an account? ":"Don't have an account? "}<Link className="text-violet-400" href={signup?"/login":"/signup"}>{signup?"Sign In":"Sign Up"}</Link></p>
 </form></div>}

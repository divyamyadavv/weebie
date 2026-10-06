"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {CheckCircle2,Mail,LogOut,RefreshCw,ShieldCheck} from "lucide-react";
import Logo from "../../components/Logo";
import {useAuth} from "../../components/AuthProvider";
import {applyVerificationCode,requiresEmailVerification,sendVerificationEmail,signOutAll} from "../../lib/auth";

const actionError=error=>{
 if(["auth/expired-action-code","auth/invalid-action-code"].includes(error?.code))return "This verification link has expired or was already used. Request a fresh link below.";
 if(error?.code==="auth/too-many-requests")return "Too many requests. Wait a little and try again.";
 return error?.message?.replace(/^Firebase: /,"")||"We couldn't verify that link. Request a new one and try again.";
};

export default function VerifyEmail(){
 const router=useRouter(),{user,loading,requiresVerification,refreshUser}=useAuth();
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[resendUntil,setResendUntil]=useState(0),[now,setNow]=useState(Date.now()),[completed,setCompleted]=useState(false),[needsSignIn,setNeedsSignIn]=useState(false);
 const processedCode=useRef(""),checkedUid=useRef("");
 const destination=()=>{const params=new URLSearchParams(window.location.search);let next=params.get("next");if(!next){const continuation=params.get("continueUrl");if(continuation){try{const url=new URL(continuation,window.location.origin);next=url.searchParams.get("next")||url.pathname}catch{next=null}}}return next?.startsWith("/")&&!next.startsWith("//")?next:"/dashboard"};
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),mode=params.get("mode"),oobCode=params.get("oobCode");
  if(mode==="verifyEmail"&&oobCode&&processedCode.current!==oobCode){
   processedCode.current=oobCode;setBusy(true);setMessage("");
   applyVerificationCode(oobCode).then(async()=>{
    setCompleted(true);
    const refreshed=await refreshUser();
    if(refreshed?.emailVerified)router.replace(destination());else setNeedsSignIn(true);
   }).catch(error=>setMessage(actionError(error))).finally(()=>setBusy(false));
   return;
  }
  if(loading)return;
  if(params.get("send")==="failed")setMessage("The verification email couldn't be sent. Check your Firebase email template and authorized domain, then resend.");
  if(params.get("sent")==="1")setResendUntil(Date.now()+60_000);
  if(!user){setNeedsSignIn(true);return}
  if(checkedUid.current!==user.uid){
   checkedUid.current=user.uid;
   refreshUser().then(refreshed=>{if(refreshed?.emailVerified)router.replace(destination())}).catch(error=>setMessage(actionError(error)));
   return;
  }
  if(user.emailVerified||!requiresVerification)router.replace(destination());
 },[user,loading,requiresVerification,router,refreshUser]);
 useEffect(()=>{if(!resendUntil)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[resendUntil]);
 const remaining=Math.max(0,Math.ceil((resendUntil-now)/1000));
 const resend=async()=>{
  if(!user)return router.replace(`/login?next=${encodeURIComponent(destination())}`);
  setBusy(true);setMessage("");
  try{
   const actionUrl=new URL("/verify-email",window.location.origin);actionUrl.searchParams.set("next",destination());
   await sendVerificationEmail(user,actionUrl.toString());setResendUntil(Date.now()+60_000);setNow(Date.now());setMessage("A verification link was sent. Check your inbox and spam folder.");
  }catch(error){setMessage(actionError(error))}finally{setBusy(false)}
 };
 const checkAgain=async()=>{setBusy(true);setMessage("");try{const refreshed=await refreshUser();if(refreshed?.emailVerified)router.replace(destination());else setMessage("Firebase still reports this email as unverified. Open the latest link from your inbox, then check again.")}catch(error){setMessage(actionError(error))}finally{setBusy(false)}};
 const logout=async()=>{setBusy(true);try{await signOutAll();router.replace("/login")}catch(error){setMessage(actionError(error))}finally{setBusy(false)}};
 if(loading||(!user&&!needsSignIn&&!completed)||busy&&!message)return <div className="grid min-h-screen place-items-center text-sm text-slate-400">Checking your account...</div>;
 return <main className="grid min-h-screen place-items-center p-4">
  <section className="card fade w-full max-w-sm space-y-4 p-7 text-center">
   <div className="flex justify-center"><Logo/></div>
   <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-violet-600/20 text-violet-300">{completed?<CheckCircle2 size={22}/>:<ShieldCheck size={22}/>}</div>
   <h1 className="text-xl font-bold">{completed?"Email verified":"Verify your email"}</h1>
   <p className="text-sm text-slate-400">{completed?needsSignIn?"Your email is verified. Sign in to continue.":"Your email is verified. Taking you to Weebie...":<>We sent a verification link to <b className="text-slate-200">{user?.email||"your email address"}</b>. Open it to verify your account.</>}</p>
   {message&&<p role="alert" className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-300">{message}</p>}
    {!completed&&user&&requiresVerification&&<button type="button" disabled={busy||remaining>0} onClick={resend} className="btn w-full disabled:opacity-50"><RefreshCw size={15}/>{remaining?`Resend in ${remaining}s`:"Resend Verification Email"}</button>}
   {!completed&&user&&requiresVerification&&<button type="button" disabled={busy} onClick={checkAgain} className="btn2 w-full disabled:opacity-50">I&apos;ve verified my email</button>}
   {(needsSignIn||user)&&<Link className="block text-sm text-violet-300 hover:text-white" href={`/login?next=${encodeURIComponent(destination())}`}>{completed?"Sign in":"Back to sign in"}</Link>}
   {user&&<button type="button" disabled={busy} onClick={logout} className="mx-auto flex items-center gap-2 text-xs text-slate-400 hover:text-white"><LogOut size={14}/>Sign out</button>}
   <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><Mail size={12}/>Use the latest link. Expired links can be resent.</p>
  </section>
 </main>;
}
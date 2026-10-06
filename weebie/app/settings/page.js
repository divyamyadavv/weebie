"use client";
import {useCallback,useEffect,useState} from "react";import {useRouter} from "next/navigation";
import {Bell,ChevronRight,Globe,HardDrive,KeyRound,LogOut,Shield,Trash2} from "lucide-react";
import {deleteAccount,reauthenticate,sendPasswordReset,signOutAll,updateDisplayName} from "../../lib/auth";
import {callFriendApi} from "../../lib/friendApiClient";
import {fetchWithFirebaseAuth} from "../../lib/authenticatedFetch";
import {startPresenceTracking,stopPresenceTracking} from "../../lib/presence";
import {usePreferences} from "../../lib/preferences";
import {deleteConfirmationReady,describeProviders,friendlyAuthError,hasPasswordProvider} from "../../lib/settingsUi.cjs";
import Shell from "../../components/Shell";import GoogleLogo from "../../components/GoogleLogo";import {Avatar} from "../../components/ui";import {useAuth} from "../../components/AuthProvider";

function Switch({checked,onChange,label,description}){
 return <div className="flex items-start gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-sm">{label}</p>{description&&<p className="mt-0.5 text-xs text-slate-400">{description}</p>}</div>
  <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={()=>onChange(!checked)} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${checked?"bg-violet-600":"bg-white/15"}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${checked?"left-[22px]":"left-0.5"}`}/></button></div>;
}
function Section({icon:Icon,title,value,open,onToggle,children}){
 return <div className="border-t border-white/10"><button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 py-3 text-left text-sm"><Icon size={16}/><span className="flex-1">{title}</span>{value&&<span className="text-slate-400">{value}</span>}<ChevronRight size={14} className={`transition ${open?"rotate-90":""}`}/></button>{open&&<div className="pb-3">{children}</div>}</div>;
}

export default function Settings(){
 const router=useRouter(),{user,serverSessionReady}=useAuth(),uid=user?.uid,{preferences,updatePreferences}=usePreferences(uid),
  [name,setName]=useState(""),[edit,setEdit]=useState(false),[msg,setMsg]=useState(""),[openSection,setOpenSection]=useState(null),
  [drive,setDrive]=useState({loaded:false,connected:false}),[blocked,setBlocked]=useState(null),[blockedError,setBlockedError]=useState(""),
  [del,setDel]=useState({open:false,text:"",password:"",busy:false,error:""});
 const email=user?.email||"",providers=describeProviders(user?.providerData),needsPassword=hasPasswordProvider(user?.providerData);
 useEffect(()=>{if(!edit)setName(user?.displayName||user?.email?.split("@")[0]||"Account")},[user,edit]);
 useEffect(()=>{
  if(!uid)return;
  let active=true;
  fetchWithFirebaseAuth("/api/drive/status").then(response=>response.json()).then(data=>{if(active)setDrive({loaded:true,connected:data?.connected===true})}).catch(()=>{if(active)setDrive({loaded:true,connected:false,unknown:true})});
  return()=>{active=false};
 },[uid]);
 const loadBlocked=useCallback(async()=>{
  setBlockedError("");
  try{const response=await fetch("/api/account/blocked",{credentials:"same-origin",cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.error||"Could not load blocked accounts.");setBlocked(data.blocked||[])}
  catch(exception){setBlocked([]);setBlockedError(exception.message)}
 },[]);
 useEffect(()=>{if(openSection==="privacy"&&blocked===null&&serverSessionReady)void loadBlocked()},[openSection,blocked,serverSessionReady,loadBlocked]);
 const toggleSection=key=>setOpenSection(current=>current===key?null:key);
 const save=async()=>{try{await updateDisplayName(name);setEdit(false);setMsg("")}catch(e){setMsg(friendlyAuthError(e))}};
 const setAppearOffline=async value=>{
  updatePreferences({appearOffline:value});
  try{if(value)await stopPresenceTracking();else if(user)await startPresenceTracking(user,()=>{})}catch{}
 };
 const disconnectDrive=async()=>{
  setMsg("");
  try{const response=await fetchWithFirebaseAuth("/api/drive/disconnect",{method:"POST"});if(!response.ok)throw new Error("Could not disconnect Google Drive.");setDrive({loaded:true,connected:false})}
  catch(exception){setMsg(exception.message)}
 };
 const unblock=async blockedUid=>{
  try{await callFriendApi({operation:"unblock",blockedUid});setBlocked(current=>(current||[]).filter(item=>item.uid!==blockedUid))}
  catch(exception){setBlockedError(exception.message)}
 };
 const resetPassword=async()=>{try{await sendPasswordReset(email);setMsg("Password reset email sent. Check your inbox.")}catch(e){setMsg(friendlyAuthError(e))}};
 const confirmDelete=async()=>{
  setDel(current=>({...current,busy:true,error:""}));
  try{await reauthenticate({password:del.password});await deleteAccount();router.replace("/")}
  catch(exception){setDel(current=>({...current,busy:false,error:friendlyAuthError(exception)}))}
 };
 const closeDelete=()=>{if(!del.busy)setDel({open:false,text:"",password:"",busy:false,error:""})};
 return <Shell><div className="mx-auto max-w-2xl space-y-6"><div className="card p-5"><h1 className="mb-4 font-bold">Account Settings</h1>
  <div className="flex items-center gap-4"><Avatar name={name||"A"} photoURL={user?.photoURL} size="h-14 w-14"/><div className="min-w-0 flex-1">{edit?<input className="input" value={name} onChange={e=>setName(e.target.value)} aria-label="Display name"/>:<b>{name}</b>}<p className="truncate text-xs text-slate-400">{email}</p></div><button onClick={edit?save:()=>setEdit(true)} className="btn2 !py-1.5">{edit?"Save":"Edit"}</button></div>
  <h2 className="mb-2 mt-5 text-xs text-slate-400">Connected Accounts</h2>
  <div className="space-y-2 text-sm">
   {providers.length?providers.map(item=><div key={item.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">{item.id==="google.com"?<GoogleLogo/>:<KeyRound size={16}/>}<span className="flex-1">{item.label}</span><span className="text-xs text-emerald-300">Signed in</span></div>):<div className="rounded-xl bg-white/5 p-3 text-slate-400">No sign-in method found.</div>}
   <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3"><HardDrive size={16}/><span className="flex-1">Google Drive<span className="block text-xs text-slate-400">{drive.loaded?(drive.connected?"Connected — you can create rooms from your videos":(drive.unknown?"Status unavailable right now":"Not connected — connect it from the Home page")):"Checking..."}</span></span>{drive.connected&&<button type="button" onClick={disconnectDrive} className="btn2 !px-3 !py-1.5 !text-xs">Disconnect</button>}</div>
  </div>
  {needsPassword&&<button type="button" onClick={resetPassword} className="mt-3 flex items-center gap-2 text-sm text-violet-300"><KeyRound size={14}/>Change password (send reset email)</button>}
  {msg&&<p role="alert" className="mt-3 text-xs text-amber-300">{msg}</p>}
  <div className="mt-4">
   <Section icon={Bell} title="Notifications" open={openSection==="notifications"} onToggle={()=>toggleSection("notifications")}>
    <Switch checked={preferences.friendRequestPopups} onChange={value=>updatePreferences({friendRequestPopups:value})} label="Friend request pop-ups" description="Show a pop-up card when someone sends you a friend request."/>
    <Switch checked={preferences.roomInvitePopups} onChange={value=>updatePreferences({roomInvitePopups:value})} label="Room invitation pop-ups" description="Show a pop-up card when a friend invites you to a room."/>
    <Switch checked={preferences.pauseAllPopups} onChange={value=>updatePreferences({pauseAllPopups:value})} label="Do not disturb" description="Turn off every pop-up above. Requests and invitations still wait for you in the bell menu."/>
    <p className="mt-1 text-xs text-slate-500">These choices are saved on this device.</p>
   </Section>
   <Section icon={Shield} title="Privacy" open={openSection==="privacy"} onToggle={()=>toggleSection("privacy")}>
    <Switch checked={preferences.appearOffline} onChange={setAppearOffline} label="Appear offline to friends" description="Friends will not see you as online. You still appear to members inside rooms you join. Saved on this device."/>
    <div className="mt-2 border-t border-white/10 pt-3"><p className="text-sm">Blocked accounts</p>
     {blocked===null?<p className="mt-2 text-xs text-slate-400">Loading...</p>:blocked.length?<ul className="mt-2 space-y-2">{blocked.map(item=><li key={item.uid} className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5"><Avatar name={item.name} photoURL={item.photoURL} size="h-8 w-8"/><span className="min-w-0 flex-1 truncate text-sm">{item.name}</span><button type="button" onClick={()=>unblock(item.uid)} className="btn2 !px-3 !py-1 !text-xs">Unblock</button></li>)}</ul>:<p className="mt-2 text-xs text-slate-400">You have not blocked anyone.</p>}
     {blockedError&&<p role="alert" className="mt-2 text-xs text-amber-300">{blockedError}</p>}
    </div>
    <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/5 p-3"><p className="flex items-center gap-2 text-sm font-semibold text-red-300"><Trash2 size={14}/>Delete account</p><p className="mt-1 text-xs text-slate-400">Permanently delete your Weebie account and personal data. This cannot be undone.</p><button type="button" onClick={()=>setDel({open:true,text:"",password:"",busy:false,error:""})} className="mt-3 rounded-xl border border-red-500/50 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/10">Delete my account</button></div>
   </Section>
   <div className="flex items-center gap-3 border-t border-white/10 py-3 text-sm"><Globe size={16}/><span className="flex-1">Language</span><span className="text-slate-400">English</span></div>
  </div>
  <button onClick={async()=>{await signOutAll();router.push("/")}} className="mt-3 flex items-center gap-2 text-sm text-red-400"><LogOut size={16}/>Logout</button></div></div>
  {del.open&&<div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" onClick={closeDelete}><section role="dialog" aria-modal="true" aria-label="Delete account" onClick={event=>event.stopPropagation()} className="w-full max-w-md rounded-2xl border border-red-500/30 bg-panel p-5 shadow-2xl">
   <h2 className="flex items-center gap-2 font-bold text-red-300"><Trash2 size={16}/>Delete your account?</h2>
   <p className="mt-2 text-sm text-slate-300">This permanently removes your sign-in account, friends and friend requests, private chats, room invitations, your Google Drive connection and your membership in every room. Messages you already sent in room chats may remain. You cannot undo this.</p>
   {needsPassword&&<input type="password" autoComplete="current-password" className="input mt-4" placeholder="Your password" value={del.password} onChange={event=>setDel(current=>({...current,password:event.target.value}))} aria-label="Your password"/>}
   {!needsPassword&&<p className="mt-3 text-xs text-slate-400">You will be asked to sign in with Google again to confirm.</p>}
   <input className="input mt-3" placeholder="Type DELETE to confirm" value={del.text} onChange={event=>setDel(current=>({...current,text:event.target.value}))} aria-label="Type DELETE to confirm"/>
   {del.error&&<p role="alert" className="mt-3 text-xs text-amber-300">{del.error}</p>}
   <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={closeDelete} disabled={del.busy} className="btn2 !py-2 disabled:opacity-50">Cancel</button><button type="button" onClick={confirmDelete} disabled={del.busy||!deleteConfirmationReady({text:del.text,needsPassword,password:del.password})} className="rounded-xl bg-red-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-40">{del.busy?"Deleting...":"Delete account"}</button></div>
  </section></div>}
 </Shell>}

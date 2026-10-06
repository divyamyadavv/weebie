"use client";
import {fbApp} from "./firebase";
import {isPresenceSessionActive} from "./presenceSessions.cjs";
import {isAppearOffline} from "./preferences.cjs";

let stopActivePresence=null;
let fallbackSessionId;

function sessionIdFor(uid){
 const key=`weebie-presence-tab:${uid}`;
 try{
  let tabId=sessionStorage.getItem(key);
  if(!tabId){tabId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;sessionStorage.setItem(key,tabId)}
  const activationId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${tabId}-${activationId}`;
 }catch{
  fallbackSessionId=fallbackSessionId||globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return fallbackSessionId;
 }
}

export async function startPresenceTracking(user,onError){
 // "Appear offline": publish no global presence lease, so friends never see this account as online.
 // (Room membership and room presence are separate and unaffected.)
 if(typeof window!=="undefined"&&isAppearOffline(window.localStorage,user?.uid))return async()=>{};
 // One tracker at a time: a tracker started from Settings (after turning "Appear offline" off) must not be doubled.
 if(stopActivePresence)return stopActivePresence;
 const app=await fbApp(),F=await import("firebase/firestore"),db=F.getFirestore(app),ref=F.doc(db,"users",user.uid,"presenceSessions",sessionIdFor(user.uid));
 let stopped=false,heartbeat;
 const existing=await F.getDocs(F.collection(db,"users",user.uid,"presenceSessions"));
 const stale=existing.docs.filter(item=>!isPresenceSessionActive(item.data()));
 await Promise.all(stale.map(item=>F.deleteDoc(item.ref)));
 const publish=()=>F.setDoc(ref,{uid:user.uid,online:true,lastSeen:F.serverTimestamp()},{merge:true}).catch(onError);
 const markOffline=()=>F.setDoc(ref,{uid:user.uid,online:false,lastSeen:F.serverTimestamp()},{merge:true}).catch(onError);
 const onPageHide=()=>{void markOffline()};
 const onPageShow=()=>{if(!stopped)void publish()};
 await publish();
 if(stopped){await markOffline();return()=>{}}
 heartbeat=setInterval(()=>{void publish()},25000);
 window.addEventListener("pagehide",onPageHide);
 window.addEventListener("pageshow",onPageShow);
 let closed=false;
 const stop=async()=>{
  if(closed)return;
  closed=true;stopped=true;clearInterval(heartbeat);window.removeEventListener("pagehide",onPageHide);window.removeEventListener("pageshow",onPageShow);
  try{await F.deleteDoc(ref)}catch(exception){onError(exception)}
  if(stopActivePresence===stop)stopActivePresence=null;
 };
 stopActivePresence=stop;
 return stop;
}

export async function stopPresenceTracking(){
 if(stopActivePresence)await stopActivePresence();
}

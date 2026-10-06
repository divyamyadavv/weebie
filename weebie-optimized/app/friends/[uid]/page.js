"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {useAuth} from "../../../components/AuthProvider";
import Shell from "../../../components/Shell";
import {Avatar} from "../../../components/ui";
import {useFriends} from "../../../lib/friends";
import {callFriendApi} from "../../../lib/friendApiClient";
import {fbApp,isFirestoreReady} from "../../../lib/firebase";
import {friendListenerFailure} from "../../../lib/friendSubscriptions.cjs";
import {ArrowLeft,Send} from "lucide-react";

function formatTimestamp(value){
 const date=typeof value?.toDate==="function"?value.toDate():value instanceof Date?value:null;
 return date?new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",month:"short",day:"numeric"}).format(date):"Sending…";
}

export default function FriendChat({params}){
 const friendUid=params.uid,{user}=useAuth(),{friends,friendsStatus}=useFriends(),friend=friends.find(item=>item.id===friendUid),isFriend=!!friend,[messages,setMessages]=useState([]),[message,setMessage]=useState(""),[loading,setLoading]=useState(true),[connection,setConnection]=useState("Connecting"),[error,setError]=useState(""),[sendError,setSendError]=useState(""),[sending,setSending]=useState(false),endRef=useRef(null);
 useEffect(()=>{
  let dead=false,unsubscribe;
  if(!user?.uid)return;
  if(friendsStatus==="loading")return;
  if(friendsStatus==="error"){setLoading(false);setError("Friends could not be loaded, so this conversation cannot be verified.");setConnection("Disconnected");return}
  if(friendsStatus!=="ready")return;
  if(!isFriend){setLoading(false);setError("Private chat is only available with an accepted friend.");return}
  if(!isFirestoreReady){setLoading(false);setError("Firebase Authentication and Firestore are not configured.");return}
  setLoading(true);setError("");setConnection("Connecting");
  (async()=>{
   try{
    const response=await callFriendApi({operation:"openChat",friendUid}),conversationId=response.data?.conversationId;
    if(!conversationId)throw new Error("Weebie could not open this private conversation.");
    const app=await fbApp(),F=await import("firebase/firestore"),db=F.getFirestore(app),messagesQuery=F.query(F.collection(db,"conversations",conversationId,"messages"),F.orderBy("createdAt","asc"),F.limitToLast(100));
    if(dead)return;
    unsubscribe=F.onSnapshot(messagesQuery,{includeMetadataChanges:true},snapshot=>{
     setMessages(snapshot.docs.map(item=>({id:item.id,...item.data()})));
     setConnection(snapshot.metadata.fromCache?"Reconnecting":"Connected");
     setLoading(false);setError("");
    },exception=>{
     if(dead)return;
     const failure=friendListenerFailure(exception,{listener:"Private conversation",path:"conversations/{conversationId}/messages"});
     console.error("[friends] Firestore listener failed",failure.diagnostic);
     setConnection("Disconnected");setLoading(false);setError(failure.message);
    });
   }catch(exception){if(!dead){setConnection("Disconnected");setLoading(false);setError(exception.message||"Could not open this private conversation.")}}
  })();
  return()=>{dead=true;unsubscribe?.()};
 },[user?.uid,friendUid,friendsStatus,isFriend]);
 useEffect(()=>{
  const offline=()=>setConnection("Offline");
  const online=()=>setConnection("Reconnecting");
  window.addEventListener("offline",offline);window.addEventListener("online",online);
  return()=>{window.removeEventListener("offline",offline);window.removeEventListener("online",online)};
 },[]);
 useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"})},[messages]);
 const send=async event=>{
  event.preventDefault();const text=message.trim();
  if(!text||sending)return;
  setSending(true);setSendError("");
  try{await callFriendApi({operation:"sendMessage",friendUid,text});setMessage("")}
  catch(exception){setSendError(exception.message||"Message could not be sent.")}
  finally{setSending(false)}
 };
 return <Shell><div className="mx-auto flex h-[min(78vh,760px)] max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-panel">
  <header className="flex items-center gap-3 border-b border-white/10 p-4"><Link href="/friends" aria-label="Back to friends" className="rounded-lg p-2 text-slate-300 hover:bg-white/10"><ArrowLeft size={18}/></Link>{friend&&<Avatar name={friend.name||"Weebie"} photoURL={friend.photoURL}/>}<div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{friend?.name||"Private chat"}</h1>{friend?.username&&<p className="truncate text-xs text-slate-400">@{friend.username}</p>}</div><span className={`text-xs ${connection==="Connected"?"text-emerald-300":"text-amber-300"}`} role="status">{connection}</span></header>
  <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">{loading?<p className="py-8 text-center text-sm text-slate-400">Loading private conversation…</p>:error?<p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">{error}</p>:messages.length?messages.map(item=><article key={item.id} className={`flex gap-2 ${item.senderUid===user?.uid?"flex-row-reverse":""}`}><Avatar name={item.senderName||"Weebie"} photoURL={item.senderPhotoURL} size="h-8 w-8"/><div className={`max-w-[82%] rounded-2xl px-3 py-2 ${item.senderUid===user?.uid?"bg-violet-600/60":"bg-white/5"}`}><div className="flex items-baseline gap-2"><b className="text-xs">{item.senderUid===user?.uid?"You":item.senderName||friend?.name||"Friend"}</b><time className="text-[10px] text-slate-400">{formatTimestamp(item.createdAt)}</time></div><p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.text}</p></div></article>):<p className="py-8 text-center text-sm text-slate-500">No messages yet. Say hello!</p>}<div ref={endRef}/></div>
  {sendError&&<p role="alert" className="px-4 pb-2 text-xs text-red-300">{sendError}</p>}
  <form onSubmit={send} className="flex gap-2 border-t border-white/10 p-3"><input className="input min-w-0 flex-1" aria-label="Message" maxLength={500} placeholder="Write a private message…" value={message} onChange={event=>setMessage(event.target.value)} disabled={!friend||!!error||sending}/><button type="submit" className="btn !px-3" aria-label="Send message" disabled={!message.trim()||sending||!!error}><Send size={16}/></button></form>
 </div></Shell>;
}

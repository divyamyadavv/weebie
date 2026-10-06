"use client";
import {useRef,useState} from "react";
import {Reply,Send,Smile,X} from "lucide-react";
import {Avatar} from "./ui";

const REACTIONS=["❤️","😂","😮","😢","👏","🔥"];
const messageTime=value=>value?new Date(value).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";

export default function RoomChat({messages,userId,disabled,onSend,onReact,endRef}){
 const [text,setText]=useState(""),[replyTo,setReplyTo]=useState(null),[reactionMenu,setReactionMenu]=useState(null),[highlighted,setHighlighted]=useState(null),[notice,setNotice]=useState("");
 const localEndRef=useRef(),messageElements=useRef(new Map()),pressTimer=useRef(),touchStart=useRef(null);
 const reply=message=>{setReplyTo({eventId:message.eventId,name:message.u||"Member",text:message.text||""});setReactionMenu(null)};
 const jumpTo=id=>{
  const target=messageElements.current.get(id);
  if(!target){setNotice("Original message is no longer available.");setTimeout(()=>setNotice(""),2500);return}
  target.scrollIntoView({behavior:"smooth",block:"center"});setHighlighted(id);setTimeout(()=>setHighlighted(value=>value===id?null:value),1400);
 };
 const send=event=>{
  event.preventDefault();if(disabled||!text.trim())return;
  onSend(text.trim(),replyTo?.eventId||null);setText("");setReplyTo(null);
 };
 const onTouchStart=event=>{touchStart.current=event.changedTouches[0]?.clientX??null};
 const onTouchEnd=(event,message)=>{
  const endX=event.changedTouches[0]?.clientX??null,startX=touchStart.current;touchStart.current=null;
  if(startX!=null&&endX!=null&&startX-endX>64)reply(message);
 };
 const openReactions=message=>{if(message.system||!message.text)return;setReactionMenu(current=>current===message.eventId?null:message.eventId)};
 const startPress=message=>{clearTimeout(pressTimer.current);pressTimer.current=setTimeout(()=>openReactions(message),550)};
 const stopPress=()=>clearTimeout(pressTimer.current);

 return <>
  <div className="flex-1 space-y-3 overflow-y-auto p-3" aria-label="Room messages">
   {messages.map((message,index)=>{
    if(message.system)return <p key={message.eventId||index} className="system-message">{message.systemType==="moderation"?`${message.actorName} ${({kick:"kicked",mute:"muted",unmute:"unmuted",disableMic:"disabled the mic for",enableMic:"enabled the mic for"}[message.action]||message.action)} ${message.targetName}`:`${message.u} ${message.systemType==="join"?"joined":"left"} the room`} · {messageTime(message.t)}</p>;
    const original=message.replyTo?messages.find(item=>item.eventId===message.replyTo&&!item.system):null;
    const own=message.uid===userId;
    return <div key={message.eventId||index} ref={node=>{if(node&&message.eventId)messageElements.current.set(message.eventId,node);else if(message.eventId)messageElements.current.delete(message.eventId)}} onTouchStart={onTouchStart} onTouchEnd={event=>onTouchEnd(event,message)} onContextMenu={event=>{event.preventDefault();openReactions(message)}} onPointerDown={()=>startPress(message)} onPointerUp={stopPress} onPointerCancel={stopPress} onPointerMove={stopPress} className={`group relative flex ${own?"justify-end":"justify-start"}`}>
     <div className={`flex max-w-[90%] items-start gap-2 ${own?"flex-row-reverse":""}`}>
      <Avatar name={message.u} size="h-7 w-7"/>
      <div className="min-w-0">
       {message.replyTo&&<button type="button" onClick={()=>jumpTo(message.replyTo)} disabled={!original} className="mb-1 block max-w-full border-l-2 border-violet-400/70 pl-2 text-left text-xs text-slate-400 disabled:cursor-default"><span className="block truncate">Replying to {original?.u||"unavailable message"}</span><span className="block max-w-[min(56vw,420px)] truncate text-slate-300">{original?.text||"Original message unavailable"}</span></button>}
       <div className="flex items-center gap-2 text-[11px] text-slate-400"><b className={own?"text-violet-200":"text-slate-200"}>{own?"You":message.u}</b><time dateTime={message.t?new Date(message.t).toISOString():undefined}>{messageTime(message.t)}</time>
        <button type="button" onClick={()=>reply(message)} title="Reply to message" aria-label={`Reply to ${message.u||"member"}'s message`} className="rounded p-1 text-violet-200 opacity-100 transition hover:bg-violet-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Reply size={14}/></button>
        <button type="button" onClick={()=>openReactions(message)} title="Add a reaction" aria-label="Add a reaction" className="rounded p-1 text-slate-300 opacity-100 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"><Smile size={14}/></button>
       </div>
       <p id={`room-message-${message.eventId}`} className={`whitespace-pre-wrap break-words text-sm ${highlighted===message.eventId?"rounded bg-violet-500/20 outline outline-1 outline-violet-300/50":""}`}>{message.text}</p>
       {message.reactions&&<div className={`mt-1 flex gap-1 ${own?"justify-end":"justify-start"}`}>{Object.entries(message.reactions).map(([reaction,count])=><span key={reaction} className="rounded-full border border-white/10 px-1.5 py-0.5 text-xs text-slate-300">{reaction} {count}</span>)}</div>}
       {reactionMenu===message.eventId&&<div className="mt-1 flex gap-1 rounded-lg border border-white/10 bg-panel p-1 shadow-xl" role="group" aria-label="Message reactions">{REACTIONS.map(reaction=><button type="button" key={reaction} onClick={()=>{onReact(message.eventId,reaction);setReactionMenu(null)}} className="rounded-lg p-1.5 text-lg transition hover:bg-white/10" aria-label={`React ${reaction}`}>{reaction}</button>)}</div>}
      </div>
     </div>
    </div>;
   })}
    <div ref={endRef||localEndRef}/>
  </div>
  {notice&&<p role="status" className="px-3 text-xs text-slate-400">{notice}</p>}
  <form onSubmit={send} className="border-t border-white/10 p-3">
   {replyTo&&<div className="mb-2 flex items-start gap-2 border-l-2 border-violet-400/70 pl-2 text-xs"><span className="min-w-0 flex-1"><b className="text-violet-200">Replying to {replyTo.name}</b><span className="block truncate text-slate-300">{replyTo.text||"Message"}</span></span><button type="button" onClick={()=>setReplyTo(null)} aria-label="Cancel reply" title="Cancel reply" className="rounded p-1 text-slate-400 hover:bg-white/10"><X size={14}/></button></div>}
   <div className="flex gap-2"><input disabled={disabled} className="input !py-2" placeholder={disabled?"Room access removed":"Type a message..."} value={text} onChange={event=>setText(event.target.value)}/><button disabled={disabled||!text.trim()} className="btn !px-3" aria-label="Send message" title="Send message"><Send size={16}/></button></div>
  </form>
 </>;
}
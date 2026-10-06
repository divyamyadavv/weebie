"use client";
import {useEffect,useRef,useState} from "react";
import {isFirebaseReady,isFirestoreReady,fbApp} from "./firebase";
import {currentUser} from "./auth";
import {connectFirestoreRoom,firestoreRoomError} from "./firestoreRooms";
import {isCurrentUserKicked} from "./roomKickNavigation.cjs";

const eventId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const eventPayload=(code,uid,state)=>({...state,roomId:code,eventId:eventId(),eventTimestamp:Date.now(),controllerId:uid});
const systemMessage=(type,name)=>({system:true,systemType:type,u:name,t:Date.now(),eventId:`${type}-${name}-${Date.now()}`});
const moderationMessage=(action,actor,target)=>({system:true,systemType:"moderation",action,actorName:actor,targetName:target,t:Date.now(),eventId:`moderation-${action}-${target}-${Date.now()}`});

async function demo(code,me,room,h){
 const id=sessionStorage.weebie_tab||(sessionStorage.weebie_tab=Math.random().toString(36).slice(2,8));
 const ch=new BroadcastChannel("weebie-"+code),peers={},announced=new Set();
 let cur=room.src?eventPayload(code,id,{source:room.src,playing:false,time:0,eventType:"source"}):null;
 const adminKey=`weebie-room-admin-${code}`;
 const leadershipKey=`weebie-room-leadership-${code}`;
 let leadership=JSON.parse(localStorage.getItem(leadershipKey)||"null")||{originalOwnerId:room.originalOwnerId||localStorage.getItem(adminKey)||id,ownerUid:room.ownerUid||room.originalOwnerId||localStorage.getItem(adminKey)||id,adminId:room.adminId||localStorage.getItem(adminKey)||id,voluntaryTransfer:false,nextJoinSequence:1,members:{}};
 if(!leadership.ownerUid)leadership.ownerUid=leadership.voluntaryTransfer?leadership.adminId:leadership.originalOwnerId;
 const existing=leadership.members[id],joinSequence=existing?.joinSequence||leadership.nextJoinSequence++;
 leadership.members[id]={...(existing||{}),name:me,joinSequence,online:true,muted:true};
 let adminId=leadership.adminId||leadership.originalOwnerId||id,ownPresence={online:true,muted:true,speaking:false};
 leadership.adminId=adminId;localStorage.setItem(leadershipKey,JSON.stringify(leadership));localStorage.setItem(adminKey,adminId);
 const send=m=>ch.postMessage({...m,from:id});
 const readLeadership=()=>{leadership=JSON.parse(localStorage.getItem(leadershipKey)||"null")||leadership;return leadership};
 const roster=()=>h.setMembers([{id,name:me,self:true,admin:id===adminId,...ownPresence},...Object.entries(peers).map(([key,value])=>({...value,id:key,admin:key===adminId}))]);
 const elect=()=>{leadership=JSON.parse(localStorage.getItem(leadershipKey)||"{}")||leadership;const active=Object.entries(leadership.members||{}).filter(([,member])=>member.online&&!member.kicked&&!member.blocked&&!member.removed&&member.eligible!==false);const owner=leadership.members?.[leadership.ownerUid],current=leadership.members?.[leadership.adminId];let next=owner?.online&&!owner.kicked&&!owner.blocked&&!owner.removed&&owner.eligible!==false?leadership.ownerUid:current?.online&&!current.kicked&&!current.blocked&&!current.removed&&current.eligible!==false?leadership.adminId:active.sort(([,a],[,b])=>(Number(a.joinSequence)||Number.MAX_SAFE_INTEGER)-(Number(b.joinSequence)||Number.MAX_SAFE_INTEGER))[0]?.[0]||null;if(next!==leadership.adminId){leadership.adminId=next;leadership.leadershipRevision=(leadership.leadershipRevision||0)+1;localStorage.setItem(leadershipKey,JSON.stringify(leadership));adminId=next;localStorage.setItem(adminKey,adminId);h.setMeta({name:room.name||"Watch Room",adminId,ownerUid:leadership.ownerUid})}return leadership};
 const onMessage=({data:m})=>{
  if(m.type==="hello"){readLeadership();const fresh=!peers[m.from];peers[m.from]={name:m.name,online:true,muted:m.muted!==false,joinSequence:m.joinSequence};leadership.members[m.from]={...(leadership.members[m.from]||{}),name:m.name,joinSequence:m.joinSequence||leadership.nextJoinSequence++,online:true};localStorage.setItem(leadershipKey,JSON.stringify(leadership));elect();if(fresh&&!announced.has(`join-${m.from}`)){announced.add(`join-${m.from}`);h.add(systemMessage("join",m.name))}roster();send({type:"here",name:me,adminId,id,joinSequence});if(cur)send({type:"state",s:cur})}
  else if(m.type==="here"){readLeadership();peers[m.from]={name:m.name,online:true,muted:m.muted!==false,joinSequence:m.joinSequence};leadership.members[m.from]={...(leadership.members[m.from]||{}),name:m.name,joinSequence:m.joinSequence||leadership.nextJoinSequence++,online:true};elect();roster()}
  else if(m.type==="bye"){readLeadership();if(peers[m.from]&&!announced.has(`leave-${m.from}`)){announced.add(`leave-${m.from}`);h.add(systemMessage("leave",peers[m.from].name))}if(leadership.members[m.from])leadership.members[m.from].online=false;localStorage.setItem(leadershipKey,JSON.stringify(leadership));delete peers[m.from];elect();roster()}
  else if(m.type==="presence"){readLeadership();if(peers[m.from])Object.assign(peers[m.from],m.value);if(leadership.members[m.from])Object.assign(leadership.members[m.from],m.value);localStorage.setItem(leadershipKey,JSON.stringify(leadership));roster()}
  else if(m.type==="state"&&m.s?.controllerId===adminId){cur=m.s;h.setState(m.s)}
  else if(m.type==="transfer"&&m.from===adminId){readLeadership();leadership.adminId=m.to;leadership.ownerUid=m.to;leadership.voluntaryTransfer=true;adminId=m.to;localStorage.setItem(leadershipKey,JSON.stringify(leadership));localStorage.setItem(adminKey,adminId);h.setMeta({adminId,ownerUid:m.to});roster()}
  else if(m.type==="moderate"&&m.from===adminId){h.applyModeration(m.to,m.action);h.add(moderationMessage(m.action,m.actorName,m.targetName))}
  else if(m.type==="msg")h.add(m.x)
 };
 ch.onmessage=onMessage;
 h.setMeta({name:room.name||"Watch Room",adminId});h.setState(cur);h.applyModeration(id,"join");elect();roster();h.setLive(true);
 h.setBlocked(Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith("weebie-block-")).map(key=>[key.slice("weebie-block-".length),true])));
 if(!sessionStorage.getItem(`weebie-joined-${code}`)){sessionStorage.setItem(`weebie-joined-${code}`,"1");h.add(systemMessage("join",me))}
 send({type:"hello",name:me,adminId,muted:true,joinSequence});
 const bye=()=>send({type:"bye"});addEventListener("pagehide",bye);
 return {id,backend:"demo",off:()=>{send({type:"bye"});removeEventListener("pagehide",bye);ch.close()},
  state:s=>{if(id!==adminId)return;cur=eventPayload(code,id,s);h.setState(cur);send({type:"state",s:cur})},
  transfer:to=>{if(id!==adminId||!to||to===adminId)return;readLeadership();leadership.adminId=to;leadership.ownerUid=to;leadership.voluntaryTransfer=true;adminId=to;localStorage.setItem(leadershipKey,JSON.stringify(leadership));localStorage.setItem(adminKey,adminId);h.setMeta({adminId,ownerUid:to});send({type:"transfer",to})},
  presence:value=>{ownPresence={...ownPresence,...value};send({type:"presence",value});roster()},
  moderate:(to,action,targetName)=>{if(!to||to===id||(action!=="report"&&action!=="friend"&&action!=="block"&&id!==adminId))return;if(action==="friend")return localStorage.setItem(`weebie-friend-request-${to}`,JSON.stringify({from:id,name:me,t:Date.now()}));if(action==="block")return localStorage.setItem(`weebie-block-${to}`,"1");if(action==="report")return localStorage.setItem(`weebie-report-${to}`,JSON.stringify({from:id,t:Date.now()}));const message={type:"moderate",to,action,actorName:me,targetName};send(message);h.applyModeration(to,action);h.add(moderationMessage(action,me,targetName))},
  msg:x=>{const message={...x,uid:id};send({type:"msg",x:message});h.add(message)}}
}

async function fire(code,me,room,h){
 const app=await fbApp(),D=await import("firebase/database"),u=await currentUser();
 if(!u)throw new Error("Please sign in with Firebase to use synchronized rooms.");
 const db=D.getDatabase(app),metaRef=D.ref(db,`rooms/${code}/meta`),memberRef=D.ref(db,`rooms/${code}/members/${u.uid}`);
 try{await D.runTransaction(metaRef,current=>current||{name:room.name||"Watch Room",originalOwnerId:u.uid,ownerUid:u.uid,adminId:u.uid,voluntaryTransfer:false,createdAt:Date.now(),source:room.src||null,nextJoinSequence:1})}catch(exception){if(exception.code!=="PERMISSION_DENIED")throw exception}
 let existing={};try{existing=(await D.get(memberRef)).val()||{}}catch{}
 if(existing.kicked)throw new Error("You were removed from this room and cannot rejoin with this invite.");
 await D.update(memberRef,{name:me,online:true,muted:true,joinedAt:existing.joinedAt||Date.now(),kicked:false});
 let meta=(await D.get(metaRef)).val()||{};
 let sequence=existing.joinSequence;
 if(!sequence){const sequenceResult=await D.runTransaction(D.ref(db,`rooms/${code}/meta/nextJoinSequence`),current=>(Number(current)||1)+1);sequence=Number(sequenceResult.snapshot.val())-1}
 let adminId=meta.adminId,previousMembers=null,lastPresenceAnnouncement={};
 await D.update(memberRef,{name:me,online:true,muted:true,joinSequence:sequence});
 const offs=[];
 offs.push(D.onValue(D.ref(db,".info/connected"),snap=>{h.setLive(!!snap.val());if(snap.val()){D.onDisconnect(memberRef).update({online:false});D.update(memberRef,{online:true})}}));
 offs.push(D.onValue(metaRef,snap=>{const next=snap.val()||{};adminId=next.adminId;h.setMeta(next)}));
 offs.push(D.onValue(D.ref(db,`rooms/${code}/playback`),snap=>h.setState(snap.val())));
 const membersRef=D.ref(db,`rooms/${code}/members`);
 offs.push(D.onValue(memberRef,snap=>{const own=snap.val();if(own?.kicked)h.applyModeration(u.uid,"kick");if(own?.blocked)h.applyModeration(u.uid,"block");if(own?.micDisabled)h.applyModeration(u.uid,"disableMic")}));
 offs.push(D.onValue(membersRef,snap=>{
  const values=snap.val()||{};
  if(previousMembers){Object.entries(values).forEach(([key,value])=>{if(value.online&&!previousMembers[key]?.online&&Date.now()-(lastPresenceAnnouncement[`join-${key}`]||0)>15000){lastPresenceAnnouncement[`join-${key}`]=Date.now();h.add(systemMessage("join",value.name))}});Object.entries(previousMembers).forEach(([key,value])=>{if(value.online&&(!values[key]||!values[key].online)&&Date.now()-(lastPresenceAnnouncement[`leave-${key}`]||0)>15000){lastPresenceAnnouncement[`leave-${key}`]=Date.now();h.add(systemMessage("leave",value.name))}})}
  previousMembers=values;
    h.setRoomMemberActivity(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{kicked:value.kicked===true,lastSeen:value.lastSeen||null,reinviteInvitationId:value.reinviteInvitationId||null}])));
    const own=values[u.uid];if(own?.kicked)h.applyModeration(u.uid,"kick");if(own?.blocked)h.applyModeration(u.uid,"block");if(own?.micDisabled)h.applyModeration(u.uid,"disableMic");
  h.setMembers(Object.entries(values).map(([key,value])=>({id:key,...value,self:key===u.uid,admin:key===adminId})));
 }));
 offs.push(D.onValue(D.ref(db,`blocks/${u.uid}`),snap=>h.setBlocked(snap.val()||{})));
 offs.push(D.onChildAdded(D.query(D.ref(db,`rooms/${code}/messages`),D.limitToLast(100)),snap=>h.add({...snap.val(),eventId:snap.val()?.eventId||snap.key})));
 return {id:u.uid,backend:"firebase",off:()=>offs.forEach(stop=>stop()),
  state:s=>{if(u.uid!==adminId)return;const payload=eventPayload(code,u.uid,s);D.set(D.ref(db,`rooms/${code}/playback`),payload)},
  transfer:async to=>{if(u.uid!==adminId||!to||to===adminId)return;const target=(await D.get(D.ref(db,`rooms/${code}/members/${to}`))).val();if(!target?.online||target.kicked||target.blocked||target.removed)throw new Error("That member is not eligible for leadership.");await D.runTransaction(metaRef,current=>current&&current.adminId===u.uid?{...current,adminId:to,ownerUid:to,voluntaryTransfer:true,adminTransferId:eventId(),adminTransferTimestamp:Date.now()}:current)},
  presence:value=>D.update(memberRef,value),
  moderate:async(to,action,targetName)=>{if(!to||to===u.uid||(action!=="report"&&action!=="friend"&&action!=="block"&&u.uid!==adminId))return;if(action==="report")return D.push(D.ref(db,`rooms/${code}/reports`),{reporterId:u.uid,targetId:to,createdAt:Date.now()});if(action==="friend")throw new Error("Use the Friends request workflow.");if(action==="block")return D.set(D.ref(db,`blocks/${u.uid}/${to}`),true);const targetRef=D.ref(db,`rooms/${code}/members/${to}`),target=(await D.get(targetRef)).val();if(!target)throw new Error("That member is no longer in the room.");const updates={kick:{kicked:true,online:false},disableMic:{micDisabled:true},enableMic:{micDisabled:false},mute:{roomMuted:true},unmute:{roomMuted:false}}[action];if(updates){await D.update(targetRef,updates);await D.push(D.ref(db,`rooms/${code}/messages`),{...moderationMessage(action,me,target.name),uid:u.uid})}},
  msg:x=>D.push(D.ref(db,`rooms/${code}/messages`),{...x,uid:u.uid})}
}

export function useRoom(code,me,onReact,room={}){
 const [state,setState]=useState(null),[meta,setMeta]=useState(null),[members,setMembers]=useState([]),[roomMemberActivity,setRoomMemberActivity]=useState({}),[msgs,setMsgs]=useState([]),[live,setLive]=useState(false),[err,setErr]=useState(""),[id,setId]=useState(null),[moderation,setModeration]=useState({}),[blocked,setBlocked]=useState({}),a=useRef(),rx=useRef(),idRef=useRef(),blockedRef=useRef({});idRef.current=id;blockedRef.current=blocked;
 rx.current=onReact;
 useEffect(()=>{if(!me)return;let dead=false;
   const add=m=>{if(m.uid&&blockedRef.current[m.uid])return;if(m.react&&m.messageId){setMsgs(current=>current.map(message=>message.eventId===m.messageId?{...message,reactions:{...(message.reactions||{}),[m.e]:(message.reactions?.[m.e]||0)+1}}:message));return}m.react?(Date.now()-m.t<5000&&rx.current?.(m.e)):setMsgs(x=>x.some(message=>message.eventId&&message.eventId===m.eventId)?x:[...x,m])};
  const applyModeration=(target,action)=>{if(target===idRef.current){if(isCurrentUserKicked(idRef.current,target,action)){setModeration(x=>({...x,kicked:true}));setLive(false)}else if(action==="block")setModeration(x=>({...x,blocked:true}));else if(action==="disableMic"||action==="enableMic")setModeration(x=>({...x,micDisabled:action==="disableMic"}))}setMembers(current=>current.map(member=>member.id===target?{...member,...({kick:{kicked:true,online:false},disableMic:{micDisabled:true},enableMic:{micDisabled:false},mute:{roomMuted:true},unmute:{roomMuted:false},block:{blocked:true}}[action]||{})}:member))};
  const connect=isFirestoreReady?connectFirestoreRoom:isFirebaseReady?fire:demo;
  connect(code,me,room,{setState,setMeta,setMembers,setRoomMemberActivity,add,setLive,setBlocked,setErr,applyModeration}).then(x=>{if(dead)x.off();else{a.current=x;setId(x.id)}}).catch(e=>setErr(firestoreRoomError(e)));
  return()=>{dead=true;a.current?.off();a.current=null}},[code,me,room.name,room.src?.id,room.src?.fileId]);
 const name=me;
 return {state,meta,members,roomMemberActivity,msgs,live,err,id,moderation,blocked,backend:isFirestoreReady?"firestore":isFirebaseReady?"firebase":"demo",isAdmin:!!id&&meta?.adminId===id,
  pushState:s=>a.current?.state(s),transferAdmin:uid=>a.current?.transfer(uid),setPresence:value=>a.current?.presence(value),
  moderate:(uid,action,targetName)=>a.current?.moderate(uid,action,targetName),leave:()=>{a.current?.off();a.current=null;setLive(false)},send:(text,replyTo=null)=>a.current?.msg({eventId:eventId(),u:name,text,t:Date.now(),...(replyTo?{replyTo}:{})}),react:e=>a.current?.msg({react:true,e,t:Date.now()}),reactMessage:(messageId,e)=>a.current?.msg({eventId:eventId(),react:true,messageId,e,t:Date.now()})};
}

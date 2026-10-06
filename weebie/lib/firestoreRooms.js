import {fbApp} from "./firebase";
import {currentUser} from "./auth";
import {activeRoomMemberUids,activeRoomMemberRecords,isPresenceSessionActive,needsRoomMemberReconciliation,replacementPresenceSession,roomMemberSnapshotRecord} from "./presenceSessions.cjs";
import {callFriendApi} from "./friendApiClient";
import {classifyPresenceFailure,resolveRoomAdminId} from "./roomPresenceRecovery.cjs";

const roomCode=()=>globalThis.crypto?.randomUUID?.().replaceAll("-","").slice(0,12).toUpperCase()||Math.random().toString(36).slice(2,14).toUpperCase();
const displayName=user=>user.displayName||user.email?.split("@")[0]||"Member";
const makeEventId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function firestoreContext(){
 const user=await currentUser();
 if(!user)throw new Error("Sign in before creating or joining a room.");
 const F=await import("firebase/firestore"),db=F.getFirestore(await fbApp());
 return {F,db,user};
}

export async function createFirestoreRoom({name,source=null}){
 const {F,db,user}=await firestoreContext();
 for(let attempt=0;attempt<4;attempt++){
  const code=roomCode(),roomRef=F.doc(db,"rooms",code),memberRef=F.doc(roomRef,"members",user.uid),userRoomRef=F.doc(db,"users",user.uid,"rooms",code);
  try{
   await F.runTransaction(db,async transaction=>{
    if((await transaction.get(roomRef)).exists())throw new Error("ROOM_CODE_COLLISION");
    const now=Date.now();
    transaction.set(roomRef,{code,name:name.trim(),hostId:user.uid,adminId:user.uid,ownerUid:user.uid,originalOwnerId:user.uid,voluntaryTransfer:false,source,playing:false,time:0,playbackRate:1,eventTimestamp:now,eventType:"source",controllerId:user.uid,createdAt:F.serverTimestamp(),updatedAt:F.serverTimestamp()});
    transaction.set(memberRef,{uid:user.uid,name:displayName(user),photoURL:user.photoURL||"",online:true,muted:true,speaking:false,sessionId:makeEventId(),joinSequence:1,joinedAt:F.serverTimestamp(),lastSeen:F.serverTimestamp(),kicked:false});
    transaction.set(userRoomRef,{code,name:name.trim(),joinedAt:F.serverTimestamp()});
   });
   return code;
  }catch(error){if(error.message==="ROOM_CODE_COLLISION"&&attempt<3)continue;throw new Error(roomError(error))}
 }
 throw new Error("Could not create a unique room code. Try again.");
}

export async function getMyFirestoreRooms(){
 const user=await currentUser();
 if(!user)throw new Error("Sign in to view your rooms.");
 const response=await fetch("/api/rooms/active",{method:"POST",headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||"Active rooms could not be loaded.");
 return Array.isArray(result.activeRooms)?result.activeRooms:[];
}

export function subscribeMyFirestoreRooms(user,{onRooms,onPastRooms,onError,onStatus}){
 let stopped=false,retryTimer=null,controller=null;
 const parseFrames=(text,onFrame)=>{
  const frames=text.split(/\r?\n\r?\n/);
  const remainder=frames.pop()||"";
  for(const frame of frames){
   const data=frame.split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).join("\n");
   if(data){try{onFrame(JSON.parse(data))}catch{}}
  }
  return remainder;
 };
 const connect=async()=>{
  if(stopped)return;
  if(typeof navigator!=="undefined"&&!navigator.onLine){onRooms([]);onPastRooms?.([]);onStatus?.("offline");return}
  controller=new AbortController();
  try{
   const response=await fetch("/api/rooms/active",{headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:"no-store",signal:controller.signal});
   if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||"Active rooms could not be loaded.")}
   if(!response.body)throw new Error("Live active-room updates are unavailable in this browser.");
   onStatus?.("loading");onError?.("");
   const reader=response.body.getReader(),decoder=new TextDecoder();
   let buffer="";
   while(!stopped){
    const {done,value}=await reader.read();
    if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    buffer=parseFrames(buffer,payload=>{
     if(payload.error){onError?.(payload.error);onStatus?.("error");return}
     if(Array.isArray(payload.activeRooms))onRooms(payload.activeRooms);
     if(Array.isArray(payload.pastRooms))onPastRooms?.(payload.pastRooms);
     if(payload.status)onStatus?.(payload.status);
    });
   }
   if(!stopped){onStatus?.("loading");retryTimer=setTimeout(connect,1200)}
  }catch(error){
   if(!stopped&&error?.name!=="AbortError"){
    onRooms([]);onPastRooms?.([]);
    onStatus?.(typeof navigator!=="undefined"&&!navigator.onLine?"offline":"error");
    onError?.(firestoreRoomError(error));
    retryTimer=setTimeout(connect,3000);
   }
  }
 };
 const online=()=>{clearTimeout(retryTimer);onError?.("");void connect()};
 const offline=()=>{controller?.abort();onRooms([]);onPastRooms?.([]);onStatus?.("offline")};
 onStatus?.("loading");void connect();
 if(typeof window!=="undefined"){window.addEventListener("online",online);window.addEventListener("offline",offline)}
 return()=>{stopped=true;clearTimeout(retryTimer);controller?.abort();if(typeof window!=="undefined"){window.removeEventListener("online",online);window.removeEventListener("offline",offline)}};
}

export async function getMyActiveFirestoreRoom(){
 const {F,db,user}=await firestoreContext(),memberships=await F.getDocs(F.collection(db,"users",user.uid,"rooms"));
 const rooms=await Promise.all(memberships.docs.map(async membership=>{
  const roomRef=F.doc(db,"rooms",membership.id),memberRef=F.doc(roomRef,"members",user.uid),[room,member]=await Promise.all([F.getDoc(roomRef),F.getDoc(memberRef)]);
  if(!room.exists()||!member.exists()||member.data().kicked===true)return null;
  const sessions=await F.getDocs(F.query(F.collection(roomRef,"presenceSessions"),F.where("uid","==",user.uid)));
  if(!sessions.docs.some(session=>isPresenceSessionActive(session.data())))return null;
  return {code:membership.id,name:room.data().name||"Watch Room"};
 }));
 return rooms.find(Boolean)||null;
}

const roomError=error=>{
 const message=String(error?.message||"");
 if(error?.code==="resource-exhausted"||message.toLowerCase().includes("resource_exhausted")||message.toLowerCase().includes("quota exceeded"))return "Firestore's daily read quota is exhausted. This room was not created; wait until the quota resets before trying again.";
 if(message.includes("firestore.googleapis.com")||message.includes("Cloud Firestore API has not been used")||message.includes("PERMISSION_DENIED: Cloud Firestore"))return "Cloud Firestore API is disabled for this project. Enable the Cloud Firestore API and create the (default) Firestore database in Firebase Console, then retry.";
 if(error?.code==="permission-denied"||message.includes("Missing or insufficient permissions"))return "Firestore denied this request. Check that this account has active room presence and that the configured Firestore rules match this app.";
 if(error?.code==="unavailable"||error?.code==="network-request-failed")return "Firestore is unavailable. Check your connection and try again.";
 return error?.message||"Could not connect to this room.";
};
export const firestoreRoomError=roomError;
const systemMessage=(type,name)=>({system:true,systemType:type,u:name,t:Date.now(),eventId:`${type}-${makeEventId()}`});
const moderationMessage=(action,actor,target)=>({system:true,systemType:"moderation",action,actorName:actor,targetName:target,t:Date.now(),eventId:`moderation-${action}-${makeEventId()}`});

export async function connectFirestoreRoom(code,name,room,h){
 const {F,db,user}=await firestoreContext();
 const roomRef=F.doc(db,"rooms",code),memberRef=F.doc(roomRef,"members",user.uid),userRoomRef=F.doc(db,"users",user.uid,"rooms",code),sessionId=makeEventId();
 const roomSessionRef=F.doc(roomRef,"presenceSessions",`${user.uid}_${sessionId}`);
 let joined=false;
 const runJoinTransaction=async()=>{
 for(let attempt=0;attempt<3;attempt++){
  try{
   await F.runTransaction(db,async transaction=>{
    const roomSnapshot=await transaction.get(roomRef);
    if(!roomSnapshot.exists())throw new Error("Room not found. Check the Room ID or invite link.");
    const memberSnapshot=await transaction.get(memberRef),oldMember=memberSnapshot.data()||{};
    if(oldMember.kicked)throw new Error("You were removed from this room and cannot rejoin with this invite.");
    joined=!memberSnapshot.exists()||oldMember.online!==true||!oldMember.sessionId;
    transaction.set(memberRef,{uid:user.uid,name,photoURL:user.photoURL||"",online:true,muted:oldMember.muted??true,speaking:false,sessionId,joinSequence:oldMember.joinSequence||Date.now(),joinedAt:oldMember.joinedAt||F.serverTimestamp(),lastSeen:F.serverTimestamp(),kicked:false},{merge:true});
    transaction.set(userRoomRef,{code,name:roomSnapshot.data().name||"Watch Room",joinedAt:F.serverTimestamp()});
    transaction.set(roomSessionRef,{uid:user.uid,online:true,lastSeen:F.serverTimestamp()});
   });
   break;
  }catch(error){
   if(error?.code!=="failed-precondition"||attempt===2)throw error;
  }
 }
 };
 await runJoinTransaction();
 await callFriendApi({operation:"roomJoined",roomId:code}).catch(error=>h.setErr(error.message||"Room invitations could not be refreshed."));
 await F.setDoc(roomSessionRef,{uid:user.uid,online:true,lastSeen:F.serverTimestamp()});
 let serverClockOffset=0;
 const syncServerPresence=async operation=>{
  const requestStartedAt=Date.now();
  const token=await user.getIdToken();
  const response=await fetch(`/api/rooms/${encodeURIComponent(code)}/presence`,{
   method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
   body:JSON.stringify({operation,sessionId}),cache:"no-store",...(operation==="leave"?{keepalive:true}:{})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||"Room presence could not be synchronized."),{status:response.status});
  if(typeof result.serverNow!=="number"||!Number.isFinite(result.serverNow))throw new Error("Room presence did not include trusted server time.");
  serverClockOffset=result.serverNow-((requestStartedAt+Date.now())/2);
  return result;
 };
 try{await syncServerPresence("heartbeat")}
 catch(error){
  await F.runTransaction(db,async transaction=>{
   const memberSnapshot=await transaction.get(memberRef),sessionSnapshot=await transaction.get(roomSessionRef);
   if(sessionSnapshot.exists())transaction.delete(roomSessionRef);
   if(memberSnapshot.exists()&&memberSnapshot.data().sessionId===sessionId)transaction.update(memberRef,{online:false,sessionId:null,lastSeen:F.serverTimestamp()});
  }).catch(cleanupError=>h.setErr(roomError(cleanupError)));
  throw error;
 }
 if(joined)F.addDoc(F.collection(roomRef,"messages"),{...systemMessage("join",name),uid:user.uid}).catch(error=>h.setErr(roomError(error)));

 let adminId=null,closed=false,lastPlaybackWrite=0,pendingPlayback=null,playbackTimer=null;
 let presenceSessions=[],roomMembers=[];
 let presenceRepairInProgress=false;
 const listeners=[],activeDataListeners=[];
 const activeDataHealthy=new Set();
 let listenerRetryTimer=null,listenerRetryAttempt=0,listenerRecoveryInProgress=false;
 const setError=error=>h.setErr(roomError(error));
 const scheduleActiveListenerRecovery=()=>{
  if(closed||listenerRetryTimer||listenerRecoveryInProgress)return;
  const delay=Math.min(1000*2**Math.min(listenerRetryAttempt,5),30000);
  listenerRetryAttempt++;
  listenerRetryTimer=setTimeout(()=>{
   listenerRetryTimer=null;
   void recoverActiveDataListeners();
  },delay);
 };
 const listenerError=source=>error=>{
  if(closed)return;
  console.error(`[room:${code}] ${source} listener failed`,error?.code||"unknown");
  activeDataHealthy.delete(source);
  setError(error);
  if(error?.code==="permission-denied"&&["members","presence","messages"].includes(source))scheduleActiveListenerRecovery();
 };
 const setPresenceError=error=>{if(error?.code!=="failed-precondition")setError(error)};
 // A 409 means this tab's presence session no longer exists on the server (pagehide/bfcache restore,
 // long sleep, or pruning) even though the tab is still open. Re-create the same session through the
 // normal join transaction (which still rejects kicked users) instead of staying a ghost member.
 let rejoinInFlight=null;
 const recoverPresence=error=>{
  if(closed)return;
  if(classifyPresenceFailure(error)!=="rejoin"){setPresenceError(error);return}
  if(rejoinInFlight)return rejoinInFlight;
  rejoinInFlight=(async()=>{
   try{
    await runJoinTransaction();
    if(closed){await syncServerPresence("leave").catch(()=>{});return}
    await syncServerPresence("heartbeat");
   }catch(rejoinError){if(!closed)setPresenceError(rejoinError)}
   finally{rejoinInFlight=null}
  })();
  return rejoinInFlight;
 };
 const markActiveDataHealthy=source=>{
  activeDataHealthy.add(source);
  if(activeDataHealthy.size===3){
   listenerRetryAttempt=0;
   h.setErr("");
  }
 };
 const detachActiveDataListeners=()=>{
  for(const unsubscribe of activeDataListeners){
   unsubscribe();
   const index=listeners.indexOf(unsubscribe);
   if(index!==-1)listeners.splice(index,1);
  }
  activeDataListeners.length=0;
 };
 const subscribeActiveDataListeners=()=>{
  activeDataListeners.push(F.onSnapshot(F.collection(roomRef,"members"),snapshot=>{
   roomMembers=snapshot.docs.map(item=>roomMemberSnapshotRecord(item.id,item.data(),user.uid,adminId))
    .sort((a,b)=>(a.joinSequence||0)-(b.joinSequence||0));
   h.setRoomMemberActivity(Object.fromEntries(snapshot.docs.map(item=>[item.id,{kicked:item.data().kicked===true,lastSeen:item.data().lastSeen,reinviteInvitationId:item.data().reinviteInvitationId||null}])));
   applyMemberPresence();
   markActiveDataHealthy("members");
  },listenerError("members")));
  activeDataListeners.push(F.onSnapshot(F.collection(roomRef,"presenceSessions"),snapshot=>{
   presenceSessions=snapshot.docs.map(item=>({...item.data(),documentId:item.id}));
   applyMemberPresence();
   markActiveDataHealthy("presence");
  },listenerError("presence")));
  activeDataListeners.push(F.onSnapshot(F.query(F.collection(roomRef,"messages"),F.orderBy("t","asc"),F.limitToLast(100)),snapshot=>{
   snapshot.docs.forEach(item=>h.add({...item.data(),eventId:item.id}));
   markActiveDataHealthy("messages");
  },listenerError("messages")));
  listeners.push(...activeDataListeners);
 };
 const recoverActiveDataListeners=async()=>{
  if(closed||listenerRecoveryInProgress)return;
  listenerRecoveryInProgress=true;
   let retry=false;
   try{
    await syncServerPresence("heartbeat");
    if(closed)return;
    detachActiveDataListeners();
    activeDataHealthy.clear();
    subscribeActiveDataListeners();
  }catch(error){
   const action=classifyPresenceFailure(error);
   if(action==="rejoin"){await recoverPresence(error);retry=!closed}
   else{setPresenceError(error);retry=action==="retry"}
  }finally{
   listenerRecoveryInProgress=false;
    if(retry)scheduleActiveListenerRecovery();
   }
  };
 const applyMemberPresence=()=>{
  const now=Date.now()+serverClockOffset;
  h.setMembers(activeRoomMemberRecords(roomMembers,presenceSessions,now).map(member=>({...member,self:member.id===user.uid,admin:member.id===adminId})));
  if(closed||presenceRepairInProgress||!roomMembers.some(member=>needsRoomMemberReconciliation(member,presenceSessions,now)))return;
  presenceRepairInProgress=true;
  void Promise.resolve(syncServerPresence("heartbeat").catch(recoverPresence)).finally(()=>{presenceRepairInProgress=false});
 };
 const persistPlayback=state=>{
  if(Number(state.time)<1&&["play","seeked"].includes(state.eventType))console.warn("[playback] time reset?",state);
  const wait=state.eventType==="progress"?4000-(Date.now()-lastPlaybackWrite):0;
  if(wait>0){
   pendingPlayback=state;
   if(!playbackTimer)playbackTimer=setTimeout(()=>{playbackTimer=null;const latest=pendingPlayback;pendingPlayback=null;if(latest)persistPlayback(latest)},wait);
   return;
  }
  pendingPlayback=null;clearTimeout(playbackTimer);playbackTimer=null;lastPlaybackWrite=Date.now();
  const playbackRate=Number(state.playbackRate)||1,update={source:state.source||null,playing:state.playing===true,time:Number(state.time)||0,eventTimestamp:Date.now(),eventType:state.eventType||"playback",controllerId:user.uid,updatedAt:F.serverTimestamp()};
  if(playbackRate!==1||state.eventType==="speed")update.playbackRate=playbackRate;
  const writePlayback=async()=>{
   try{await F.updateDoc(roomRef,update)}
   catch(error){
    if(error?.code==="permission-denied"){
     try{await syncServerPresence("heartbeat");await F.updateDoc(roomRef,update);return}
     catch(retryError){console.warn("[playback] write failed",retryError?.code||error.code,update.eventType);setError(retryError);return}
    }
    console.warn("[playback] write failed",error?.code,update.eventType);
    setError(error);
   }
  };
  void writePlayback();
 };
 listeners.push(F.onSnapshot(roomRef,snapshot=>{
  if(!snapshot.exists()){h.setLive(false);h.setMeta(null);h.setState(null);h.setErr("This room was deleted or is no longer available.");return}
  const data=snapshot.data();adminId=resolveRoomAdminId(data);
  h.setMeta({...data,adminId,originalOwnerId:data.originalOwnerId||data.hostId});
  roomMembers=roomMembers.map(member=>({...member,admin:member.id===adminId}));
  applyMemberPresence();
  h.setState(data.source?{roomId:code,source:data.source,playing:data.playing===true,time:Number(data.time)||0,playbackRate:Number(data.playbackRate)||1,eventTimestamp:Number(data.eventTimestamp)||Date.now(),serverTimestamp:data.updatedAt?.toMillis?.()||null,eventType:data.eventType||"source",controllerId:data.controllerId||adminId}:null);
  h.setErr("");h.setLive(true);
 },listenerError("room")));
 subscribeActiveDataListeners();
 listeners.push(F.onSnapshot(memberRef,snapshot=>{
  const member=snapshot.data();
  if(member?.kicked)h.applyModeration(user.uid,"kick");
  if(member?.blocked)h.applyModeration(user.uid,"block");
  if(member?.micDisabled)h.applyModeration(user.uid,"disableMic");
  if(member?.micDisabled===false)h.applyModeration(user.uid,"enableMic");
 },listenerError("member")));
 const blockedRef=F.collection(db,"users",user.uid,"blocks");
 listeners.push(F.onSnapshot(blockedRef,snapshot=>h.setBlocked(Object.fromEntries(snapshot.docs.map(item=>[item.id,true]))),listenerError("blocks")));

 const markOfflineClientFallback=async()=>{
  try{
   const sessionsQuery=F.query(F.collection(roomRef,"presenceSessions"),F.where("uid","==",user.uid));
   const sessionsSnapshot=await F.getDocs(sessionsQuery);
   await F.runTransaction(db,async transaction=>{
    const [memberSnapshot,...sessionSnapshots]=await Promise.all([
     transaction.get(memberRef),
     ...sessionsSnapshot.docs.map(item=>transaction.get(item.ref))
    ]);
    const member=memberSnapshot.data();
    transaction.delete(roomSessionRef);
    if(!memberSnapshot.exists()||member.sessionId!==sessionId)return;
    const replacement=replacementPresenceSession(user.uid,sessionId,sessionSnapshots.map((snapshot,index)=>({id:sessionsSnapshot.docs[index].id,data:snapshot.data()})));
    if(replacement)transaction.update(memberRef,{online:true,sessionId:replacement.sessionId,lastSeen:F.serverTimestamp(),photoURL:user.photoURL||""});
    else transaction.update(memberRef,{online:false,sessionId:null,lastSeen:F.serverTimestamp()});
   });
  }catch(error){setPresenceError(error)}
 };
 const markOffline=async()=>{
  try{await syncServerPresence("leave")}
  catch(error){setPresenceError(error);await markOfflineClientFallback()}
 };
 const refreshPresence=()=>syncServerPresence("heartbeat").catch(recoverPresence);
 const heartbeat=setInterval(refreshPresence,20000);
 const onPageHide=()=>{void markOffline()};
 const onPageShow=()=>refreshPresence();
 // Hidden tabs are throttled by browsers; refresh the lease as soon as the tab is visible or the network is back.
 const onVisibilityChange=()=>{if(typeof document!=="undefined"&&document.visibilityState==="visible")void refreshPresence()};
 const onOnline=()=>{void refreshPresence()};
 if(typeof window!=="undefined"){window.addEventListener("pagehide",onPageHide);window.addEventListener("pageshow",onPageShow);window.addEventListener("online",onOnline)}
 if(typeof document!=="undefined")document.addEventListener("visibilitychange",onVisibilityChange);
 const presenceExpiry=setInterval(applyMemberPresence,10000);

 return {id:user.uid,backend:"firestore",off:()=>{
    if(closed)return;closed=true;clearInterval(heartbeat);clearInterval(presenceExpiry);clearTimeout(playbackTimer);clearTimeout(listenerRetryTimer);pendingPlayback=null;listeners.forEach(unsubscribe=>unsubscribe());
  if(typeof window!=="undefined"){window.removeEventListener("pagehide",onPageHide);window.removeEventListener("pageshow",onPageShow);window.removeEventListener("online",onOnline)}
  if(typeof document!=="undefined")document.removeEventListener("visibilitychange",onVisibilityChange);
  void markOffline();
 },
  state:state=>{
   if(user.uid!==adminId)return;
    persistPlayback(state);
  },
  transfer:async targetId=>{
   if(user.uid!==adminId)throw new Error("Room leadership has changed. Try again.");
   if(!targetId||targetId===adminId)return;
   const presence=await syncServerPresence("heartbeat");
   if(presence.adminId!==user.uid)throw new Error("Room leadership has changed. Try again.");
   const trustedNow=Date.now()+serverClockOffset;
   if(!activeRoomMemberUids(roomMembers,presenceSessions,trustedNow).has(targetId))throw new Error("That member is not eligible for leadership.");
   try{
    await F.runTransaction(db,async transaction=>{
    const targetRef=F.doc(roomRef,"members",targetId);
    const [roomSnapshot,targetSnapshot]=await Promise.all([transaction.get(roomRef),transaction.get(targetRef)]);
    if(!targetSnapshot.exists()||targetSnapshot.data().uid!==targetId||targetSnapshot.data().kicked||targetSnapshot.data().blocked||targetSnapshot.data().removed||targetSnapshot.data().eligible===false)throw new Error("That member is not eligible for leadership.");
    const targetSessionId=targetSnapshot.data().sessionId;
    const targetSessionRef=typeof targetSessionId==="string"?F.doc(roomRef,"presenceSessions",`${targetId}_${targetSessionId}`):null;
    const targetSession=targetSessionRef?await transaction.get(targetSessionRef):null;
    if(!activeRoomMemberUids(
     [{id:targetId,data:targetSnapshot.data()}],
     targetSession?.exists()?[{...targetSession.data(),documentId:targetSessionRef.id}]:[],
     trustedNow
    ).has(targetId))throw new Error("That member is not eligible for leadership.");
    if(!roomSnapshot.exists()||roomSnapshot.data().adminId!==user.uid)throw new Error("Room leadership has changed. Try again.");
    transaction.update(roomRef,{adminId:targetId,ownerUid:targetId,voluntaryTransfer:true,controllerId:user.uid,eventTimestamp:Date.now(),eventType:"admin-transfer",updatedAt:F.serverTimestamp()});
    });
   }catch(error){
    console.error(`[room:${code}] admin transfer failed`,error?.code||"unknown",error?.message||"");
    throw new Error(roomError(error));
   }
  },
  presence:value=>F.updateDoc(memberRef,value).catch(setError),
  moderate:async(targetId,action,targetName)=>{
   if(!targetId||targetId===user.uid)return;
   if(action==="friend")throw new Error("Use the Friends request workflow.");
   if(action==="report")return F.addDoc(F.collection(roomRef,"reports"),{reporterId:user.uid,targetId,createdAt:F.serverTimestamp()});
   if(action==="block")return callFriendApi({operation:"block",friendUid:targetId});
   if(user.uid!==adminId)throw new Error("Only the room admin can moderate members.");
   const memberRefToUpdate=F.doc(roomRef,"members",targetId),target=(await F.getDoc(memberRefToUpdate)).data();
   if(!target)throw new Error("That member is no longer in the room.");
   if(action==="kick")await callFriendApi({operation:"kickRoomMember",roomId:code,targetUid:targetId});
   else{
    const updates={disableMic:{micDisabled:true},enableMic:{micDisabled:false},mute:{roomMuted:true},unmute:{roomMuted:false}}[action];
    if(!updates)return;
    await F.updateDoc(memberRefToUpdate,updates);
   }
   await F.addDoc(F.collection(roomRef,"messages"),{...moderationMessage(action,name,target.name||targetName),uid:user.uid});
  },
  msg:message=>F.addDoc(F.collection(roomRef,"messages"),{...message,uid:user.uid}).catch(setError)
 };
}
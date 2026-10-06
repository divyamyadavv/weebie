const DEFAULT_LEASE_MS=75000;
const FUTURE_CLOCK_TOLERANCE_MS=30000;
// Expired presence sessions are kept briefly (a sleeping laptop can resume), then deleted so the
// collection - which every heartbeat transaction reads in full - cannot grow without bound.
const SESSION_RETENTION_MS=15*60*1000;
const MAX_SESSION_PRUNES_PER_RUN=25;

function timestampMillis(value){
 if(typeof value?.toMillis==="function")return value.toMillis();
 if(value instanceof Date)return value.getTime();
 if(typeof value==="number")return value;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?parsed:0;
}

function activeSession(session,now,leaseMs){
 const lastSeen=timestampMillis(session?.lastSeen);
 return session?.online===true&&lastSeen>0&&now-lastSeen<leaseMs&&lastSeen-now<=FUTURE_CLOCK_TOLERANCE_MS;
}

function activeMemberLease(uid,member,sessions,now,leaseMs){
 if(member?.online!==true||typeof member.sessionId!=="string"||timestampMillis(member.lastSeen)<=0)return null;
 const session=sessions.get(`${uid}_${member.sessionId}`);
 if(!activeSession(session,now,leaseMs)||now-timestampMillis(member.lastSeen)>=leaseMs||timestampMillis(member.lastSeen)-now>FUTURE_CLOCK_TOLERANCE_MS)return null;
 return session;
}

function eligibleMember(member){
 return member?.kicked!==true&&member?.blocked!==true&&member?.removed!==true&&member?.eligible!==false;
}

function memberOrder(first,second){
 // joinedAt is a server timestamp that the Firestore rules fix at creation and make immutable, so it
 // is the trusted seniority key. joinSequence is client-written and is only a fallback for legacy
 // members that have no joinedAt.
 const firstJoinedAt=timestampMillis(first.member.joinedAt),secondJoinedAt=timestampMillis(second.member.joinedAt);
 if(firstJoinedAt>0&&secondJoinedAt>0&&firstJoinedAt!==secondJoinedAt)return firstJoinedAt-secondJoinedAt;
 const firstSequence=Number(first.member.joinSequence),secondSequence=Number(second.member.joinSequence);
 const firstHasSequence=Number.isFinite(firstSequence)&&firstSequence>0,secondHasSequence=Number.isFinite(secondSequence)&&secondSequence>0;
 if(firstHasSequence&&secondHasSequence&&firstSequence!==secondSequence)return firstSequence-secondSequence;
 if(firstHasSequence!==secondHasSequence)return firstHasSequence?-1:1;
 return first.uid.localeCompare(second.uid);
}

async function reconcileRoomLeadership(db,roomId,{now=Date.now(),leaseMs=DEFAULT_LEASE_MS,retentionMs=SESSION_RETENTION_MS,leaveSession=null,heartbeatSession=null}={}){
 const roomRef=db.doc(`rooms/${roomId}`);
 return db.runTransaction(async transaction=>{
  const roomSnapshot=await transaction.get(roomRef);
  if(!roomSnapshot.exists)return {status:"missing",adminId:null};
  const [memberSnapshot,sessionSnapshot]=await Promise.all([
   transaction.get(db.collection(`rooms/${roomId}/members`)),
   transaction.get(db.collection(`rooms/${roomId}/presenceSessions`))
  ]);
  const room=roomSnapshot.data()||{},members=new Map(),sessions=new Map(),activeUids=new Set(),memberRepairs=[];
  let presenceRepaired=false;
  const changedSession=leaveSession||heartbeatSession;
  if(changedSession&&changedSession.uid!==changedSession.expectedUid)throw new Error("Room presence can only be changed by its owning account.");
  const changedSessionId=changedSession?`${changedSession.uid}_${changedSession.sessionId}`:null;
  for(const document of memberSnapshot.docs){
   const member=document.data();
   if(member?.uid===document.id&&eligibleMember(member))members.set(document.id,member);
  }
  for(const document of sessionSnapshot.docs){
   const session=document.data();
   if(session?.uid)sessions.set(document.id,{...session,documentId:document.id});
  }
  if(heartbeatSession){
   const member=members.get(heartbeatSession.uid),session=sessions.get(changedSessionId);
   if(!member||!session||session.uid!==heartbeatSession.uid)throw new Error("This room session is no longer active.");
   const renewed={...session,online:true,lastSeen:new Date(now)};
   sessions.set(changedSessionId,renewed);
   transaction.update(db.doc(`rooms/${roomId}/presenceSessions/${changedSessionId}`),{online:true,lastSeen:new Date(now)});
   if(member.sessionId===heartbeatSession.sessionId){
    member.online=true;member.lastSeen=new Date(now);
    memberRepairs.push({uid:heartbeatSession.uid,online:true,lastSeen:new Date(now)});
   }
  }
  let prunedSessions=0;
  for(const [documentId,session] of sessions){
   if(activeSession(session,now,leaseMs))continue;
   const lastSeen=timestampMillis(session.lastSeen);
   // A session is only dead when it is expired AND long past the lease (or has no usable timestamp).
   // A future-skewed timestamp is never treated as dead here.
   if((lastSeen<=0||now-lastSeen>=retentionMs)&&prunedSessions<MAX_SESSION_PRUNES_PER_RUN){
    transaction.delete(db.doc(`rooms/${roomId}/presenceSessions/${documentId}`));
    sessions.delete(documentId);
    prunedSessions++;
    presenceRepaired=true;
    continue;
   }
   if(session.online!==true)continue;
   sessions.set(documentId,{...session,online:false});
   transaction.update(db.doc(`rooms/${roomId}/presenceSessions/${documentId}`),{online:false});
   presenceRepaired=true;
  }
  if(leaveSession){
   const session=sessions.get(changedSessionId);
   if(session&&session.uid!==leaveSession.uid)throw new Error("This room session is no longer owned by your account.");
   sessions.delete(changedSessionId);
   if(session)transaction.delete(db.doc(`rooms/${roomId}/presenceSessions/${changedSessionId}`));
  }
  for(const [uid,member] of members){
   const leases=[...sessions.entries()]
    .filter(([documentId,session])=>documentId.startsWith(`${uid}_`)&&session.uid===uid&&activeSession(session,now,leaseMs))
    .sort((first,second)=>timestampMillis(second[1].lastSeen)-timestampMillis(first[1].lastSeen));
   const activeLease=leases[0];
   if(!activeLease){
    if(member.online===true||member.sessionId!=null)memberRepairs.push({uid,online:false,sessionId:null});
    continue;
   }
   activeUids.add(uid);
   const sessionId=activeLease[0].slice(uid.length+1),sessionLastSeen=activeLease[1].lastSeen;
   if(activeMemberLease(uid,member,sessions,now,leaseMs)!==activeLease[1]
    ||member.sessionId!==sessionId
    ||now-timestampMillis(member.lastSeen)>=leaseMs){
    const existingRepair=memberRepairs.find(repair=>repair.uid===uid);
    if(existingRepair)Object.assign(existingRepair,{online:true,sessionId,lastSeen:sessionLastSeen});
    else memberRepairs.push({uid,online:true,sessionId,lastSeen:sessionLastSeen});
   }
  }
  const persistentOwnerUid=room.ownerUid
   ||(room.voluntaryTransfer===true?room.adminId:null)
   ||room.originalOwnerId
   ||room.hostId
   ||room.adminId
   ||null;
  const isActive=uid=>!!uid&&members.has(uid)&&activeUids.has(uid);
  const currentAdminUid=room.adminId||null;
  const candidates=[...members.entries()]
   .filter(([uid])=>activeUids.has(uid))
   .map(([uid,member])=>({uid,member}))
   .sort(memberOrder);
  const nextAdminUid=isActive(persistentOwnerUid)
   ?persistentOwnerUid
   :isActive(currentAdminUid)
    ?currentAdminUid
    :candidates[0]?.uid||null;
  const updates={};
  if(!room.ownerUid&&persistentOwnerUid)updates.ownerUid=persistentOwnerUid;
  if(currentAdminUid!==nextAdminUid)updates.adminId=nextAdminUid;
  for(const repair of memberRepairs){
   const {uid,...data}=repair;
   transaction.update(db.doc(`rooms/${roomId}/members/${uid}`),data);
   presenceRepaired=true;
  }
  if(Object.keys(updates).length){
   updates.leadershipRevision=(Number(room.leadershipRevision)||0)+1;
   updates.leadershipUpdatedAt=new Date(now);
   transaction.update(roomRef,updates);
  }
  return {status:Object.keys(updates).length||presenceRepaired?"updated":"unchanged",adminId:nextAdminUid,ownerUid:persistentOwnerUid};
 });
}

module.exports={DEFAULT_LEASE_MS,SESSION_RETENTION_MS,reconcileRoomLeadership};

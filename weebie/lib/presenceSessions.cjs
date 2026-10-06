const PRESENCE_STALE_AFTER_MS=75000;
const FUTURE_CLOCK_TOLERANCE_MS=30000;

function timestampMillis(value){
 if(typeof value?.toMillis==="function")return value.toMillis();
 if(typeof value==="number")return value;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?parsed:0;
}

function isPresenceSessionActive(session,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 if(session?.online!==true)return false;
 const lastSeen=timestampMillis(session.lastSeen);
 return lastSeen>0&&now-lastSeen<staleAfter&&lastSeen-now<=FUTURE_CLOCK_TOLERANCE_MS;
}

function onlineFromSessions(sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 return sessions.some(session=>isPresenceSessionActive(session,now,staleAfter));
}

function activePresenceUids(sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 return new Set(sessions.filter(session=>isPresenceSessionActive(session,now,staleAfter)).map(session=>session.uid).filter(Boolean));
}

function activeRoomMemberRecords(members,sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 const sessionsById=new Map(sessions.map(session=>[session.documentId||session.id,session]));
 const activeMembers=[];
 for(const item of members){
  const uid=item.id,member=item.data||item;
  if(!uid||member?.uid!==uid||member.online!==true||typeof member.sessionId!=="string"
   ||member.kicked===true||member.blocked===true||member.removed===true||member.eligible===false)continue;
  const session=sessionsById.get(`${uid}_${member.sessionId}`);
  if(session?.uid!==uid||!isPresenceSessionActive(session,now,staleAfter))continue;
  activeMembers.push({...member,id:uid,online:true});
 }
 return activeMembers.sort((a,b)=>(Number(a.joinSequence)||0)-(Number(b.joinSequence)||0)||a.id.localeCompare(b.id));
}

function needsRoomMemberReconciliation(item,sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 const uid=item?.id,member=item?.data||item;
 if(!uid||member?.uid!==uid||member.kicked===true||member.blocked===true||member.removed===true||member.eligible===false)return false;
 const hasActiveSession=sessions.some(session=>session.uid===uid&&isPresenceSessionActive(session,now,staleAfter));
 if(!hasActiveSession)return false;
 const pointedSession=sessions.find(session=>(session.documentId||session.id)===`${uid}_${member.sessionId}`);
 return member.online!==true||typeof member.sessionId!=="string"
  ||!isPresenceSessionActive(pointedSession,now,staleAfter)
  ||!isPresenceSessionActive({online:true,lastSeen:member.lastSeen},now,staleAfter);
}

function roomMemberSnapshotRecord(id,member,userUid,adminUid){
 return {id,...member,self:id===userUid,admin:id===adminUid};
}

function activeRoomMemberUids(members,sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 return new Set(activeRoomMemberRecords(members,sessions,now,staleAfter).map(member=>member.id));
}

function replacementPresenceSession(uid,leavingSessionId,sessions,now=Date.now(),staleAfter=PRESENCE_STALE_AFTER_MS){
 const leavingDocumentId=`${uid}_${leavingSessionId}`;
 const candidates=sessions
  .filter(item=>item.id!==leavingDocumentId&&item.data?.uid===uid&&isPresenceSessionActive(item.data,now,staleAfter))
  .sort((first,second)=>timestampMillis(second.data.lastSeen)-timestampMillis(first.data.lastSeen)||first.id.localeCompare(second.id));
 const replacement=candidates[0];
 return replacement?{sessionId:replacement.id.slice(`${uid}_`.length),lastSeen:replacement.data.lastSeen}:null;
}

module.exports={PRESENCE_STALE_AFTER_MS,isPresenceSessionActive,onlineFromSessions,activePresenceUids,activeRoomMemberUids,activeRoomMemberRecords,needsRoomMemberReconciliation,roomMemberSnapshotRecord,timestampMillis,replacementPresenceSession};

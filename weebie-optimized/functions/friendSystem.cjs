const crypto=require("node:crypto");

function friendRequestId(senderUid,recipientUid){
 return crypto.createHash("sha256").update(`${senderUid}\0${recipientUid}`).digest("hex");
}

function friendConversationId(firstUid,secondUid){
 return crypto.createHash("sha256").update([firstUid,secondUid].sort().join("\0")).digest("hex");
}

function roomInvitationId(senderUid,recipientUid,roomId){
 return crypto.createHash("sha256").update(`${senderUid}\0${recipientUid}\0${roomId}`).digest("hex");
}

function roomReinviteId(senderUid,recipientUid,roomId){
 return crypto.createHash("sha256").update(`${senderUid}\0${recipientUid}\0${roomId}\0${crypto.randomUUID()}`).digest("hex");
}

function makeFriendRecord(uid,name,photoURL,acceptedAt,username){
 return {uid,name:name||"Weebie",photoURL:photoURL||null,...(username?{username}:{}),online:false,acceptedAt};
}

function assertUid(uid){
 if(typeof uid!=="string"||!uid||uid.length>128||uid.includes("/"))throw new Error("A valid Weebie account is required.");
}

function blockedError(){
 return new Error("This action is unavailable because one of you blocked the other.");
}

async function sendFriendRequest({db,uid,token,data,serverTimestamp}){
 const recipientUid=typeof data?.recipientUid==="string"?data.recipientUid.trim():"";
 if(!recipientUid||recipientUid===uid||recipientUid.length>128||recipientUid.includes("/"))throw new Error("A valid recipient account is required.");
 const recipientProfile=data?.recipientProfile||{},recipientDisplayName=typeof recipientProfile.name==="string"?recipientProfile.name.trim().slice(0,80):typeof data.recipientDisplayName==="string"?data.recipientDisplayName.trim().slice(0,80):"",recipientPhotoURL=typeof recipientProfile.photoURL==="string"?recipientProfile.photoURL:null,recipientUsername=typeof recipientProfile.username==="string"?recipientProfile.username:null;
 const senderDisplayName=token.name||token.email?.split("@")[0]||"Weebie",senderPhotoURL=token.picture||null,senderUsername=typeof token.username==="string"?token.username:null;
 const outgoingRef=db.doc(`friendRequests/${friendRequestId(uid,recipientUid)}`),incomingRef=db.doc(`friendRequests/${friendRequestId(recipientUid,uid)}`),senderFriendRef=db.doc(`users/${uid}/friends/${recipientUid}`),recipientFriendRef=db.doc(`users/${recipientUid}/friends/${uid}`),senderBlockRef=db.doc(`users/${uid}/blocks/${recipientUid}`),recipientBlockRef=db.doc(`users/${recipientUid}/blocks/${uid}`);
 return db.runTransaction(async transaction=>{
  const [outgoing,incoming,senderFriend,recipientFriend,senderBlock,recipientBlock]=await Promise.all([transaction.get(outgoingRef),transaction.get(incomingRef),transaction.get(senderFriendRef),transaction.get(recipientFriendRef),transaction.get(senderBlockRef),transaction.get(recipientBlockRef)]);
  if(senderBlock.exists||recipientBlock.exists)throw blockedError();
  if(senderFriend.exists||recipientFriend.exists){
   const acceptedAt=senderFriend.data()?.acceptedAt||recipientFriend.data()?.acceptedAt||serverTimestamp();
   if(!senderFriend.exists)transaction.set(senderFriendRef,makeFriendRecord(recipientUid,recipientDisplayName||"Weebie",recipientPhotoURL,acceptedAt,recipientUsername));
   if(!recipientFriend.exists)transaction.set(recipientFriendRef,makeFriendRecord(uid,senderDisplayName,senderPhotoURL,acceptedAt,senderUsername));
   for(const [ref,snapshot] of [[outgoingRef,outgoing],[incomingRef,incoming]])if(snapshot.exists&&snapshot.data().status==="pending")transaction.update(ref,{status:"accepted",respondedAt:serverTimestamp()});
   return {status:"already-friends"};
  }
  if(outgoing.exists&&outgoing.data().status==="pending")return {status:"pending",requestId:outgoingRef.id};
  if(incoming.exists&&incoming.data().status==="pending"){
   const prior=incoming.data(),acceptedAt=serverTimestamp();
   transaction.update(incomingRef,{status:"accepted",respondedAt:acceptedAt});
   transaction.set(senderFriendRef,makeFriendRecord(recipientUid,recipientDisplayName||prior.senderDisplayName,recipientPhotoURL||prior.senderPhotoURL,acceptedAt,recipientUsername||prior.senderUsername));
   transaction.set(recipientFriendRef,makeFriendRecord(uid,senderDisplayName,senderPhotoURL,acceptedAt,senderUsername));
   return {status:"accepted",requestId:incomingRef.id};
  }
  transaction.set(outgoingRef,{senderUid:uid,senderDisplayName,senderPhotoURL,...(senderUsername?{senderUsername}:{}),recipientUid,...(recipientDisplayName?{recipientDisplayName}:{}),status:"pending",createdAt:serverTimestamp()});
  return {status:"sent",requestId:outgoingRef.id};
 });
}

async function respondToFriendRequest({db,uid,token,requestId,action,serverTimestamp}){
 if(typeof requestId!=="string"||!requestId||!["accept","reject"].includes(action))throw new Error("A valid friend request response is required.");
 const requestRef=db.doc(`friendRequests/${requestId}`);
 return db.runTransaction(async transaction=>{
  const requestSnapshot=await transaction.get(requestRef);
  if(!requestSnapshot.exists)throw new Error("That friend request no longer exists.");
  const request=requestSnapshot.data();
  if(request.recipientUid!==uid||request.senderUid===uid||request.status!=="pending")throw new Error("That friend request is no longer pending.");
  const senderBlockRef=db.doc(`users/${request.senderUid}/blocks/${uid}`),recipientBlockRef=db.doc(`users/${uid}/blocks/${request.senderUid}`);
  const [senderBlock,recipientBlock]=await Promise.all([transaction.get(senderBlockRef),transaction.get(recipientBlockRef)]);
  if(senderBlock.exists||recipientBlock.exists)throw blockedError();
  const respondedAt=serverTimestamp();
  if(action==="reject"){
   transaction.update(requestRef,{status:"rejected",respondedAt});
   return {status:"rejected"};
  }
  const senderFriendRef=db.doc(`users/${uid}/friends/${request.senderUid}`),recipientFriendRef=db.doc(`users/${request.senderUid}/friends/${uid}`);
  const [senderFriend,recipientFriend]=await Promise.all([transaction.get(senderFriendRef),transaction.get(recipientFriendRef)]);
  transaction.update(requestRef,{status:"accepted",respondedAt});
  if(!senderFriend.exists||!recipientFriend.exists){
   const recipientDisplayName=token.name||token.email?.split("@")[0]||"Weebie",recipientPhotoURL=token.picture||null;
   transaction.set(senderFriendRef,makeFriendRecord(request.senderUid,request.senderDisplayName,request.senderPhotoURL,respondedAt,request.senderUsername));
   transaction.set(recipientFriendRef,makeFriendRecord(uid,recipientDisplayName,recipientPhotoURL,respondedAt,token.username));
  }
  return {status:"accepted"};
 });
}

async function deleteFriendship({db,uid,friendUid}){
 assertUid(friendUid);
 if(uid===friendUid)throw new Error("You cannot remove yourself.");
 const ownRef=db.doc(`users/${uid}/friends/${friendUid}`),otherRef=db.doc(`users/${friendUid}/friends/${uid}`);
 return db.runTransaction(async transaction=>{
  const [own,other]=await Promise.all([transaction.get(ownRef),transaction.get(otherRef)]);
  if(!own.exists&&!other.exists)throw new Error("That user is not your friend.");
  if(own.exists)transaction.delete(ownRef);
  if(other.exists)transaction.delete(otherRef);
  return {status:"deleted"};
 });
}

async function blockUser({db,uid,friendUid,serverTimestamp}){
 assertUid(friendUid);
 if(uid===friendUid)throw new Error("You cannot block yourself.");
 const blockRef=db.doc(`users/${uid}/blocks/${friendUid}`),ownFriendRef=db.doc(`users/${uid}/friends/${friendUid}`),otherFriendRef=db.doc(`users/${friendUid}/friends/${uid}`),outgoingRef=db.doc(`friendRequests/${friendRequestId(uid,friendUid)}`),incomingRef=db.doc(`friendRequests/${friendRequestId(friendUid,uid)}`);
 return db.runTransaction(async transaction=>{
  const [block,ownFriend,otherFriend,outgoing,incoming]=await Promise.all([transaction.get(blockRef),transaction.get(ownFriendRef),transaction.get(otherFriendRef),transaction.get(outgoingRef),transaction.get(incomingRef)]);
  if(ownFriend.exists)transaction.delete(ownFriendRef);
  if(otherFriend.exists)transaction.delete(otherFriendRef);
  for(const [ref,snapshot] of [[outgoingRef,outgoing],[incomingRef,incoming]]){
   if(snapshot.exists&&snapshot.data().status==="pending")transaction.update(ref,{status:"blocked",respondedAt:serverTimestamp()});
  }
  if(!block.exists)transaction.set(blockRef,{blockedUid:friendUid,createdAt:serverTimestamp()});
  return {status:"blocked"};
 });
}

async function unblockUser({db,uid,blockedUid}){
 assertUid(blockedUid);
 if(uid===blockedUid)throw new Error("You cannot unblock yourself.");
 const ref=db.doc(`users/${uid}/blocks/${blockedUid}`);
 return db.runTransaction(async transaction=>{
  const block=await transaction.get(ref);
  if(block.exists)transaction.delete(ref);
  return {status:"unblocked"};
 });
}

async function readPairState(transaction,db,firstUid,secondUid){
 const firstFriendRef=db.doc(`users/${firstUid}/friends/${secondUid}`),secondFriendRef=db.doc(`users/${secondUid}/friends/${firstUid}`),firstBlockRef=db.doc(`users/${firstUid}/blocks/${secondUid}`),secondBlockRef=db.doc(`users/${secondUid}/blocks/${firstUid}`);
 const [firstFriend,secondFriend,firstBlock,secondBlock]=await Promise.all([transaction.get(firstFriendRef),transaction.get(secondFriendRef),transaction.get(firstBlockRef),transaction.get(secondBlockRef)]);
 if(!firstFriend.exists||!secondFriend.exists)throw new Error("You can only use this feature with an accepted friend.");
 if(firstBlock.exists||secondBlock.exists)throw blockedError();
 return {firstFriendRef,secondFriendRef};
}

function conversationRef(db,firstUid,secondUid){
 const participants=[firstUid,secondUid].sort();
 return {ref:db.doc(`conversations/${friendConversationId(firstUid,secondUid)}`),participants};
}

async function openFriendConversation({db,uid,friendUid,serverTimestamp}){
 assertUid(friendUid);
 if(uid===friendUid)throw new Error("You cannot message yourself.");
 const {ref,participants}=conversationRef(db,uid,friendUid);
 return db.runTransaction(async transaction=>{
  await readPairState(transaction,db,uid,friendUid);
  const existing=await transaction.get(ref);
  if(!existing.exists)transaction.set(ref,{participants,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  return {status:"ready",conversationId:ref.id};
 });
}

async function sendFriendMessage({db,uid,friendUid,text,token,serverTimestamp}){
 assertUid(friendUid);
 if(uid===friendUid)throw new Error("You cannot message yourself.");
 if(typeof text!=="string"||!text.trim()||text.trim().length>500)throw new Error("Messages must contain between 1 and 500 characters.");
 const messageId=crypto.randomUUID(),{ref:parentRef,participants}=conversationRef(db,uid,friendUid),messageRef=db.doc(`${parentRef.path}/messages/${messageId}`),cleanText=text.trim();
 return db.runTransaction(async transaction=>{
  await readPairState(transaction,db,uid,friendUid);
  const parent=await transaction.get(parentRef);
  if(!parent.exists)transaction.set(parentRef,{participants,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
  else if(!Array.isArray(parent.data().participants)||!participants.every(item=>parent.data().participants.includes(item)))throw new Error("This conversation is no longer available.");
  const createdAt=serverTimestamp();
  transaction.set(messageRef,{senderUid:uid,senderName:token.name||token.email?.split("@")[0]||"Weebie",senderPhotoURL:token.picture||null,text:cleanText,createdAt});
  if(parent.exists)transaction.update(parentRef,{updatedAt:createdAt});
  return {status:"sent",conversationId:parentRef.id,messageId};
 });
}

function timestampMillis(value){
 if(typeof value?.toMillis==="function")return value.toMillis();
 if(typeof value==="number")return value;
 const parsed=Date.parse(value);
 return Number.isFinite(parsed)?parsed:0;
}

function isRoomPresenceSessionActive(session,now,staleAfter){
 const lastSeen=timestampMillis(session?.lastSeen);
 return session?.online===true&&lastSeen>0&&now-lastSeen<staleAfter&&lastSeen-now<=30000;
}

function hasCurrentRoomLease(uid,member,sessions,now,staleAfter){
 if(member?.uid!==uid||member.online!==true||typeof member.sessionId!=="string"
  ||member.kicked===true||member.blocked===true||member.removed===true
  ||!isRoomPresenceSessionActive({online:true,lastSeen:member.lastSeen},now,staleAfter))return false;
 return sessions.some(session=>session.id===`${uid}_${member.sessionId}`
  &&session.data().uid===uid&&isRoomPresenceSessionActive(session.data(),now,staleAfter));
}

async function sendRoomInvitation({db,uid,friendUid,roomId,token,serverTimestamp,now=Date.now(),presenceMaxAge=75000}){
 assertUid(friendUid);
 if(uid===friendUid||typeof roomId!=="string"||!/^[A-Z0-9]{6,20}$/.test(roomId))throw new Error("A valid friend and room are required.");
 const invitationId=roomInvitationId(uid,friendUid,roomId),invitationRef=db.doc(`roomInvitations/${invitationId}`),roomRef=db.doc(`rooms/${roomId}`),senderMemberRef=db.doc(`rooms/${roomId}/members/${uid}`),recipientMemberRef=db.doc(`rooms/${roomId}/members/${friendUid}`);
 return db.runTransaction(async transaction=>{
  await readPairState(transaction,db,uid,friendUid);
  const [room,senderMember,recipientMember,invitation,senderSessions]=await Promise.all([
   transaction.get(roomRef),transaction.get(senderMemberRef),transaction.get(recipientMemberRef),transaction.get(invitationRef),
   transaction.get(db.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",uid))
  ]);
  if(!room.exists||!senderMember.exists||senderMember.data().kicked===true||senderMember.data().blocked===true)throw new Error("This room is unavailable or you are not an active member.");
  if(!hasCurrentRoomLease(uid,senderMember.data(),senderSessions.docs,now,presenceMaxAge))throw new Error("Join this room before inviting a friend.");
  const recipientSessions=recipientMember.exists&&recipientMember.data().kicked!==true
   ?await transaction.get(db.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",friendUid))
   :{docs:[]};
  let targetInvitationRef=invitationRef,targetInvitation=invitation,reinvite=false;
  if(recipientMember.exists&&recipientMember.data().kicked===true){
   if(room.data().adminId!==uid)throw new Error("Only the room admin can invite a previously removed member.");
   reinvite=true;
   const priorReinviteId=recipientMember.data().reinviteInvitationId;
   if(typeof priorReinviteId==="string"){
    const priorRef=db.doc(`roomInvitations/${priorReinviteId}`),prior=await transaction.get(priorRef);
    if(prior.exists&&prior.data().status==="pending"&&prior.data().recipientUid===friendUid&&prior.data().roomId===roomId&&prior.data().reinviteForKickedMember===true)return {status:"pending",invitationId:priorRef.id};
   }
   const freshId=roomReinviteId(uid,friendUid,roomId);
   targetInvitationRef=db.doc(`roomInvitations/${freshId}`);
   targetInvitation=await transaction.get(targetInvitationRef);
  }
  if(recipientMember.exists&&recipientMember.data().kicked!==true
   &&hasCurrentRoomLease(friendUid,recipientMember.data(),recipientSessions.docs,now,presenceMaxAge))throw new Error("This friend is already in the room.");
  if(!reinvite&&targetInvitation.exists&&targetInvitation.data().status==="pending")return {status:"pending",invitationId:targetInvitationRef.id};
  const inviteData={senderUid:uid,senderName:token.name||token.email?.split("@")[0]||"Weebie",senderPhotoURL:token.picture||null,recipientUid:friendUid,roomId,roomName:room.data().name||"Watch Room",status:"pending",createdAt:serverTimestamp()};
  if(reinvite){
   inviteData.reinviteForKickedMember=true;
   transaction.set(recipientMemberRef,{reinviteInvitationId:targetInvitationRef.id},{merge:true});
  }
  transaction.set(targetInvitationRef,inviteData);
  return {status:"sent",invitationId:targetInvitationRef.id};
 });
}

async function kickRoomMember({db,uid,targetUid,roomId,serverTimestamp,now=Date.now(),presenceMaxAge=75000}){
 assertUid(targetUid);
 if(uid===targetUid||typeof roomId!=="string"||!/^[A-Z0-9]{6,20}$/.test(roomId))throw new Error("A valid room member is required.");
 const roomRef=db.doc(`rooms/${roomId}`),adminMemberRef=db.doc(`rooms/${roomId}/members/${uid}`),targetMemberRef=db.doc(`rooms/${roomId}/members/${targetUid}`);
 return db.runTransaction(async transaction=>{
  const [room,adminMember,targetMember]=await Promise.all([transaction.get(roomRef),transaction.get(adminMemberRef),transaction.get(targetMemberRef)]);
  if(!room.exists||!adminMember.exists||adminMember.data().kicked===true||adminMember.data().blocked===true)throw new Error("This room is unavailable or you are not an active member.");
  if(room.data().adminId!==uid)throw new Error("Only the room admin can moderate members.");
  if(!targetMember.exists||targetMember.data().uid!==targetUid||targetMember.data().kicked===true)throw new Error("That member is no longer in this room.");
  const [adminSessions,targetSessions,invitationSnapshot]=await Promise.all([
   transaction.get(db.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",uid)),
   transaction.get(db.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",targetUid)),
   transaction.get(db.collection("roomInvitations").where("recipientUid","==",targetUid))
  ]);
  if(!hasCurrentRoomLease(uid,adminMember.data(),adminSessions.docs,now,presenceMaxAge))throw new Error("Join this room before moderating members.");
  if(!hasCurrentRoomLease(targetUid,targetMember.data(),targetSessions.docs,now,presenceMaxAge))throw new Error("That member is no longer in this room.");
  transaction.update(targetMemberRef,{kicked:true,online:false,sessionId:null,reinviteInvitationId:null,lastSeen:serverTimestamp()});
  for(const session of targetSessions.docs)transaction.delete(session.ref||db.doc(`rooms/${roomId}/presenceSessions/${session.id}`));
  for(const invite of invitationSnapshot.docs)if(invite.data().roomId===roomId&&invite.data().status==="pending")transaction.update(invite.ref||db.doc(`roomInvitations/${invite.id}`),{status:"revoked",respondedAt:serverTimestamp()});
  return {status:"kicked"};
 });
}

async function markRoomInvitationsJoined({db,uid,roomId,serverTimestamp,now=Date.now(),presenceMaxAge=75000}){
 if(typeof roomId!=="string"||!/^[A-Z0-9]{6,20}$/.test(roomId))throw new Error("A valid room is required.");
 const roomRef=db.doc(`rooms/${roomId}`),memberRef=db.doc(`rooms/${roomId}/members/${uid}`);
 return db.runTransaction(async transaction=>{
  const [room,member,sessions,invitations]=await Promise.all([
   transaction.get(roomRef),
   transaction.get(memberRef),
   transaction.get(db.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",uid)),
   transaction.get(db.collection("roomInvitations").where("recipientUid","==",uid))
  ]);
  if(!room.exists||!member.exists||member.data().uid!==uid||member.data().kicked===true)throw new Error("Join this room before updating its invitation status.");
  if(!hasCurrentRoomLease(uid,member.data(),sessions.docs,now,presenceMaxAge))throw new Error("Join this room before updating its invitation status.");
  let updated=0;
  for(const invite of invitations.docs){
   if(invite.data().roomId===roomId&&invite.data().status==="pending"){
    transaction.update(invite.ref||db.doc(`roomInvitations/${invite.id}`),{status:"joined",respondedAt:serverTimestamp()});
    updated++;
   }
  }
  return {status:"joined",updated};
 });
}

async function respondToRoomInvitation({db,uid,token,invitationId,action,serverTimestamp}){
 if(typeof invitationId!=="string"||!invitationId||!["accept","decline"].includes(action))throw new Error("A valid room invitation response is required.");
 const invitationRef=db.doc(`roomInvitations/${invitationId}`);
 return db.runTransaction(async transaction=>{
  const invitation=await transaction.get(invitationRef);
  if(!invitation.exists)throw new Error("That room invitation no longer exists.");
  const value=invitation.data();
  if(value.recipientUid!==uid||value.senderUid===uid||(value.status!=="pending"&&!(action==="accept"&&value.status==="accepted")))throw new Error("That room invitation is no longer pending.");
  await readPairState(transaction,db,uid,value.senderUid);
  if(typeof value.roomId!=="string"||!/^[A-Z0-9]{6,20}$/.test(value.roomId))throw new Error("That room is no longer available.");
  const roomRef=db.doc(`rooms/${value.roomId}`),memberRef=db.doc(`rooms/${value.roomId}/members/${uid}`),senderMemberRef=db.doc(`rooms/${value.roomId}/members/${value.senderUid}`);
  const [room,member,senderMember]=await Promise.all([transaction.get(roomRef),transaction.get(memberRef),transaction.get(senderMemberRef)]);
  if(!room.exists)throw new Error("That room is no longer available.");
  if(!senderMember.exists||senderMember.data().kicked===true||senderMember.data().blocked===true)throw new Error("That room invitation is no longer valid.");
  const kickedMember=member.exists&&member.data().kicked===true;
  if(member.exists&&member.data().uid!==uid)throw new Error("You were removed from this room and cannot accept its invitation.");
  if(kickedMember&&(
   value.reinviteForKickedMember!==true
   ||member.data().reinviteInvitationId!==invitationId
   ||room.data().adminId!==value.senderUid
  ))throw new Error("You were removed from this room and cannot accept its invitation.");
  if(action==="decline"){
   transaction.update(invitationRef,{status:"declined",respondedAt:serverTimestamp()});
   if(kickedMember)transaction.update(memberRef,{reinviteInvitationId:null});
   return {status:"declined",roomId:value.roomId};
  }
  const presence=kickedMember?await transaction.get(db.collection(`rooms/${value.roomId}/presenceSessions`).where("uid","==",uid)):null;
  if(value.status==="pending")transaction.update(invitationRef,{status:"accepted",respondedAt:serverTimestamp()});
  if(kickedMember){
   for(const session of presence.docs)transaction.delete(session.ref||db.doc(`rooms/${value.roomId}/presenceSessions/${session.id}`));
   transaction.update(memberRef,{kicked:false,online:false,sessionId:null,reinviteInvitationId:null,lastSeen:serverTimestamp()});
  }else if(!member.exists){
   const timestamp=serverTimestamp();
   transaction.set(memberRef,{
    uid,
    name:token?.name||token?.email?.split("@")[0]||"Member",
    photoURL:token?.picture||"",
    online:true,
    muted:true,
    speaking:false,
    sessionId:null,
    joinSequence:Date.now(),
    joinedAt:timestamp,
    lastSeen:timestamp,
    kicked:false
   });
  }
  transaction.set(db.doc(`users/${uid}/rooms/${value.roomId}`),{
   code:value.roomId,
   name:room.data().name||"Watch Room",
   joinedAt:member.exists?member.data().joinedAt||serverTimestamp():serverTimestamp()
  });
  return {status:"accepted",roomId:value.roomId};
 });
}

module.exports={friendRequestId,friendConversationId,roomInvitationId,sendFriendRequest,respondToFriendRequest,deleteFriendship,blockUser,unblockUser,openFriendConversation,sendFriendMessage,sendRoomInvitation,kickRoomMember,markRoomInvitationsJoined,respondToRoomInvitation,timestampMillis};
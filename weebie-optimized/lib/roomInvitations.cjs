function subscribeRoomInvitations(modular,db,senderUid,roomId,{onInvitations,onError}){
 const invitations=modular.query(
  modular.collection(db,"roomInvitations"),
  modular.where("senderUid","==",senderUid)
 );
 return modular.onSnapshot(invitations,snapshot=>{
  onInvitations(snapshot.docs
   .map(document=>({id:document.id,...document.data()}))
   .filter(invitation=>invitation.roomId===roomId&&invitation.status==="pending"));
 },onError);
}

function timestampParts(value){
 if(value&&typeof value.seconds==="number")return [value.seconds,Number(value.nanoseconds)||0];
 if(value&&typeof value.toMillis==="function")return [Math.floor(value.toMillis()/1000),Math.floor(value.toMillis()%1000)*1000000];
 const millis=value instanceof Date?value.getTime():typeof value==="number"?value:Date.parse(value);
 return Number.isFinite(millis)&&millis>0?[Math.floor(millis/1000),Math.floor(millis%1000)*1000000]:null;
}

function wasAlreadyInRoom(invitation,member){
 const invitedAt=timestampParts(invitation.createdAt),lastSeen=timestampParts(member?.lastSeen);
 if(!invitedAt||!lastSeen)return false;
 return lastSeen[0]>invitedAt[0]||(lastSeen[0]===invitedAt[0]&&lastSeen[1]>=invitedAt[1]);
}

function roomInviteStatus(friendUid,activeMemberUids,pendingInvitations,memberActivity={}){
 if(activeMemberUids.has(friendUid))return "member";
 const member=memberActivity[friendUid];
 return pendingInvitations.some(invitation=>invitation.recipientUid===friendUid&&(
  member?.kicked===true
   ?member.reinviteInvitationId===invitation.id
   :!wasAlreadyInRoom(invitation,member)
 ))?"invited":"invite";
}

module.exports={subscribeRoomInvitations,roomInviteStatus,wasAlreadyInRoom};

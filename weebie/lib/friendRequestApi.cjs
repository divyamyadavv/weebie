const friendSystem=require("../functions/friendSystem.cjs");

class FriendRequestApiError extends Error{
 constructor(status,message){super(message);this.status=status}
}

function mapFriendSystemError(error){
 const message=error?.message||"The friend operation could not be completed.";
 if(message==="A valid recipient account is required."||message==="A valid Weebie account is required."||message==="A valid friend and room are required."||message==="A valid room member is required."||message==="A valid friend request response is required."||message==="A valid room invitation response is required."||message==="Messages must contain between 1 and 500 characters."||message==="You cannot add yourself."||message==="You cannot message yourself."||message==="You cannot remove yourself."||message==="You cannot block yourself."||message==="You cannot unblock yourself.")return new FriendRequestApiError(400,message);
 if(message.includes("blocked the other"))return new FriendRequestApiError(403,message);
 if(message==="That user is not your friend.")return new FriendRequestApiError(404,message);
 if(message==="You can only use this feature with an accepted friend.")return new FriendRequestApiError(403,message);
 if(message==="Join this room before inviting a friend."||message==="Join this room before moderating members."||message==="Join this room before updating its invitation status."||message==="This room is unavailable or you are not an active member."||message==="Only the room admin can invite a previously removed member."||message==="Only the room admin can moderate members."||message==="You were removed from this room and cannot accept its invitation."||message==="That room invitation is no longer valid.")return new FriendRequestApiError(403,message);
 if(message==="That member is no longer in this room.")return new FriendRequestApiError(409,message);
 if(message==="This friend is already in the room.")return new FriendRequestApiError(409,message);
 if(message==="That room invitation no longer exists.")return new FriendRequestApiError(404,message);
 if(message==="That room invitation is no longer pending.")return new FriendRequestApiError(409,message);
 if(message==="That room is no longer available.")return new FriendRequestApiError(404,message);
 if(message==="That friend request no longer exists.")return new FriendRequestApiError(404,message);
 if(message==="That friend request is no longer pending.")return new FriendRequestApiError(409,message);
 if(message==="This conversation is no longer available.")return new FriendRequestApiError(409,message);
 return error;
}

async function run(system,operation){
 try{return await operation()}catch(error){throw mapFriendSystemError(error)}
}

async function executeFriendRequest({body,user,db,serverTimestamp,getUser,system=friendSystem}){
 if(!user?.uid)throw new FriendRequestApiError(401,"Sign in to Weebie before managing friend requests.");
 if(body?.operation==="send"){
  if(typeof body.recipientUid!=="string"||!body.recipientUid.trim()||body.recipientUid.trim()===user.uid||body.recipientUid.includes("/")||body.recipientUid.length>128)throw new FriendRequestApiError(400,"A valid recipient account is required.");
  if(typeof getUser!=="function")throw new FriendRequestApiError(503,"Recipient account validation is unavailable.");
  let recipient;
  try{recipient=await getUser(body.recipientUid.trim())}
  catch(error){if(error?.code==="auth/user-not-found")throw new FriendRequestApiError(404,"That Weebie account could not be found.");throw error}
  if(recipient.disabled)throw new FriendRequestApiError(403,"That Weebie account is unavailable.");
  const recipientProfile={name:recipient.displayName||recipient.email?.split("@")[0]||"Weebie",photoURL:recipient.photoURL||null,username:typeof recipient.customClaims?.username==="string"?recipient.customClaims.username:null};
  return run(system,()=>system.sendFriendRequest({
    db,
    uid:user.uid,
    token:user,
    data:{recipientUid:body.recipientUid.trim(),recipientProfile},
    serverTimestamp
   }));
 }
 if(body?.operation==="respond"){
  if(typeof body.requestId!=="string"||! /^[a-f0-9]{64}$/i.test(body.requestId)||!["accept","reject"].includes(body.action)){
   throw new FriendRequestApiError(400,"A valid friend request response is required.");
  }
  return run(system,()=>system.respondToFriendRequest({
    db,
    uid:user.uid,
    token:user,
    requestId:body.requestId,
    action:body.action,
    serverTimestamp
   }));
 }
 if(body?.operation==="delete")return run(system,()=>system.deleteFriendship({db,uid:user.uid,friendUid:body.friendUid}));
 if(body?.operation==="block")return run(system,()=>system.blockUser({db,uid:user.uid,friendUid:body.friendUid,serverTimestamp}));
 if(body?.operation==="unblock")return run(system,()=>system.unblockUser({db,uid:user.uid,blockedUid:body.blockedUid}));
 if(body?.operation==="openChat")return run(system,()=>system.openFriendConversation({db,uid:user.uid,friendUid:body.friendUid,serverTimestamp}));
 if(body?.operation==="sendMessage")return run(system,()=>system.sendFriendMessage({db,uid:user.uid,friendUid:body.friendUid,text:body.text,token:user,serverTimestamp}));
 if(body?.operation==="invite")return run(system,()=>system.sendRoomInvitation({db,uid:user.uid,friendUid:body.friendUid,roomId:body.roomId,token:user,serverTimestamp}));
 if(body?.operation==="kickRoomMember")return run(system,()=>system.kickRoomMember({db,uid:user.uid,targetUid:body.targetUid,roomId:body.roomId,serverTimestamp}));
 if(body?.operation==="roomJoined")return run(system,()=>system.markRoomInvitationsJoined({db,uid:user.uid,roomId:body.roomId,serverTimestamp}));
 if(body?.operation==="respondInvite"){
  if(typeof body.invitationId!=="string"||! /^[a-f0-9]{64}$/i.test(body.invitationId)||!["accept","decline"].includes(body.action))throw new FriendRequestApiError(400,"A valid room invitation response is required.");
  return run(system,()=>system.respondToRoomInvitation({db,uid:user.uid,token:user,invitationId:body.invitationId,action:body.action,serverTimestamp}));
 }
 throw new FriendRequestApiError(400,"Choose a valid friend request operation.");
}

module.exports={FriendRequestApiError,executeFriendRequest};

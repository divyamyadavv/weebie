const KICKED_ROOM_MESSAGE="You were removed from this room and cannot rejoin this invite.";

function roomEntryDecision({roomExists,memberExists,member}){
 if(!roomExists)return {allowed:false,code:"ROOM_NOT_FOUND",message:"This room is no longer available."};
 if(memberExists&&member?.kicked===true)return {allowed:false,code:"ROOM_KICKED",message:KICKED_ROOM_MESSAGE};
 if(memberExists&&member?.blocked===true)return {allowed:false,code:"ROOM_BLOCKED",message:"You cannot join this room."};
 return {allowed:true,code:"ROOM_ALLOWED"};
}

async function getRoomEntryDecision(db,roomId,uid){
 if(typeof roomId!=="string"||!/^[A-Z0-9]{6,20}$/.test(roomId))return {allowed:false,code:"ROOM_NOT_FOUND",message:"This room is no longer available."};
 const [room,member]=await Promise.all([
  db.doc(`rooms/${roomId}`).get(),
  db.doc(`rooms/${roomId}/members/${uid}`).get()
 ]);
 return roomEntryDecision({roomExists:room.exists,memberExists:member.exists,member:member.data()});
}

module.exports={KICKED_ROOM_MESSAGE,roomEntryDecision,getRoomEntryDecision};

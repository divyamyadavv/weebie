function authorizeRoomVideo({uid,room,member,activeSession=false}){
 if(!uid)return {ok:false,status:401,message:"Sign in to Weebie to watch this room video."};
 if(!room)return {ok:false,status:404,message:"Room not found."};
 if(!member||member.kicked===true||member.blocked===true||member.online!==true||activeSession!==true)return {ok:false,status:403,message:"You are not an active member of this room."};
 const source=room.source;
 if(source?.type!=="drive"||typeof source.fileId!=="string")return {ok:false,status:404,message:"This room has no selected Drive video."};
 const creatorUid=room.originalOwnerId||room.hostId,ownerUid=source.driveOwnerUid||creatorUid;
 if(!creatorUid||ownerUid!==creatorUid)return {ok:false,status:403,message:"This room's Drive video owner is invalid."};
 return {ok:true,ownerUid,fileId:source.fileId,size:Number(source.size)||0};
}

module.exports={authorizeRoomVideo};
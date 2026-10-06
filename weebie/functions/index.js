const functions=require("firebase-functions/v1");
const admin=require("firebase-admin");
const {reconcileRoomLeadership:reconcileFirestoreRoomLeadership}=require("./roomLeadership.cjs");

admin.initializeApp();

exports.reconcileRoomLeadership=functions.database.ref("/rooms/{code}/members/{uid}").onWrite(async(change,context)=>{
 const code=context.params.code;
 const db=admin.database();
 const roomRef=db.ref(`rooms/${code}`),metaRef=roomRef.child("meta");
 const [metaSnap,membersSnap]=await Promise.all([metaRef.once("value"),roomRef.child("members").once("value")]);
 const meta=metaSnap.val();
 if(!meta)return null;
 const members=membersSnap.val()||{};
 return metaRef.transaction(current=>{
  if(!current)return current;
  const originalOwnerId=current.originalOwnerId||current.adminId||null;
  const ownerUid=current.ownerUid||(current.voluntaryTransfer?current.adminId:originalOwnerId)||null;
  const currentAdminId=current.adminId||null;
  const owner=ownerUid&&members[ownerUid];
  const currentAdmin=currentAdminId&&members[currentAdminId];
  const eligible=member=>member?.online===true&&member.kicked!==true&&member.blocked!==true&&member.removed!==true;
  const candidates=Object.entries(members).filter(([,member])=>eligible(member));
  candidates.sort(([,first],[,second])=>{
   const sequence=Number(first.joinSequence)-Number(second.joinSequence);
   if(Number.isFinite(sequence)&&sequence!==0)return sequence;
   return Number(first.joinedAt||Number.MAX_SAFE_INTEGER)-Number(second.joinedAt||Number.MAX_SAFE_INTEGER);
  });
  const nextAdmin=eligible(owner)?ownerUid:eligible(currentAdmin)?currentAdminId:candidates[0]?.[0]||null;
  if(nextAdmin===currentAdminId&&current.ownerUid===ownerUid&&current.originalOwnerId===originalOwnerId)return current;
  return {...current,ownerUid,originalOwnerId,adminId:nextAdmin,leadershipRevision:(Number(current.leadershipRevision)||0)+1,leadershipUpdatedAt:Date.now()};
 });
});

exports.reconcileFirestoreRoomLeadershipOnMemberWrite=functions.firestore.document("rooms/{roomId}/members/{uid}").onWrite(async(change,context)=>{
 const before=change.before.exists?change.before.data():null,after=change.after.exists?change.after.data():null;
 const fields=["uid","kicked","blocked","removed","eligible","online","sessionId","joinSequence","joinedAt"];
 const unchanged=(first,second)=>first===second||(typeof first?.isEqual==="function"&&first.isEqual(second));
 if(before&&after&&fields.every(field=>unchanged(before[field],after[field])))return null;
 await reconcileFirestoreRoomLeadership(admin.firestore(),context.params.roomId);
 return null;
});

exports.reconcileFirestoreRoomLeadershipOnPresenceWrite=functions.firestore.document("rooms/{roomId}/presenceSessions/{sessionId}").onWrite(async(change,context)=>{
 await reconcileFirestoreRoomLeadership(admin.firestore(),context.params.roomId);
 return null;
});

exports.cleanupDriveAuthorization=functions.firestore.document("rooms/{roomId}").onDelete(async(snapshot)=>{
 const source=snapshot.get("source");
 if(source?.type!=="drive")return null;
 const ownerUid=source.driveOwnerUid||snapshot.get("originalOwnerId")||snapshot.get("hostId");
 if(!ownerUid)return null;
 const rooms=admin.firestore().collection("rooms");
 const [driveRooms,legacyOwnerRooms,legacyHostRooms]=await Promise.all([
  rooms.where("source.driveOwnerUid","==",ownerUid).limit(1).get(),
  rooms.where("originalOwnerId","==",ownerUid).limit(1).get(),
  rooms.where("hostId","==",ownerUid).limit(1).get()
 ]);
 if(!driveRooms.empty||!legacyOwnerRooms.empty||!legacyHostRooms.empty)return null;
 await admin.firestore().doc(`driveAuthorizations/${ownerUid}`).delete();
 return null;
});

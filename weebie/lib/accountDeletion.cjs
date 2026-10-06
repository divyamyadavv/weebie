// Server-side account deletion. Uses only Firestore Admin API calls so it can be unit-tested with a fake db.
// Order matters: everything reversible/removable first, the Firebase Auth user LAST, so a failure halfway
// (for example a Firestore quota error) leaves the account usable and the user can simply try again.
const REAUTH_WINDOW_SECONDS=5*60;
const BATCH_SIZE=400;

// The ID token must come from a sign-in (or re-authentication) in the last few minutes.
function isRecentSignIn(decoded,nowSeconds=Math.floor(Date.now()/1000),windowSeconds=REAUTH_WINDOW_SECONDS){
 const authTime=Number(decoded?.auth_time);
 return Number.isFinite(authTime)&&nowSeconds-authTime<=windowSeconds&&authTime<=nowSeconds+60;
}

async function deleteRefs(db,refs){
 for(let index=0;index<refs.length;index+=BATCH_SIZE){
  const batch=db.batch();
  for(const ref of refs.slice(index,index+BATCH_SIZE))batch.delete(ref);
  await batch.commit();
 }
}

async function queryRefs(db,collection,field,operator,value){
 const snapshot=await db.collection(collection).where(field,operator,value).get();
 return snapshot.docs.map(item=>item.ref);
}

async function deleteAccountData({db,auth,uid,removeDriveGrant,reconcileRoom,log=()=>{}}){
 if(typeof uid!=="string"||!uid||uid.includes("/"))throw new Error("A valid account is required.");

 // 1. Leave every room: remove this account's member record and live sessions, then let the leadership
 //    reconciler hand admin to someone else. Chat history already written to the room is left in place.
 const roomsSnapshot=await db.collection(`users/${uid}/rooms`).get();
 const roomIds=roomsSnapshot.docs.map(item=>item.id);
 for(const roomId of roomIds){
  const sessionRefs=await queryRefs(db,`rooms/${roomId}/presenceSessions`,"uid","==",uid);
  await deleteRefs(db,[db.doc(`rooms/${roomId}/members/${uid}`),...sessionRefs]);
  if(reconcileRoom){try{await reconcileRoom(roomId)}catch(error){log("room-reconcile-failed",roomId,error?.code||"unknown")}}
 }

 // 2. Remove this account from every friend's list (the friend's own copy of the friendship).
 const friendsSnapshot=await db.collection(`users/${uid}/friends`).get();
 await deleteRefs(db,friendsSnapshot.docs.map(item=>db.doc(`users/${item.id}/friends/${uid}`)));

 // 3. Friend requests and room invitations sent by or to this account.
 const requestRefs=[
  ...await queryRefs(db,"friendRequests","senderUid","==",uid),
  ...await queryRefs(db,"friendRequests","recipientUid","==",uid),
  ...await queryRefs(db,"roomInvitations","senderUid","==",uid),
  ...await queryRefs(db,"roomInvitations","recipientUid","==",uid)
 ];
 await deleteRefs(db,requestRefs);

 // 4. Private conversations with this account (both sides), including their messages.
 const conversations=await db.collection("conversations").where("participants","array-contains",uid).get();
 for(const item of conversations.docs)await db.recursiveDelete(item.ref);

 // 5. Google Drive authorization, then everything under users/{uid} (rooms list, blocks, presence, friends).
 if(removeDriveGrant)await removeDriveGrant(uid);
 await db.recursiveDelete(db.doc(`users/${uid}`));

 // 6. Finally the sign-in account itself.
 await auth.deleteUser(uid);
 return {deleted:true,rooms:roomIds.length,friends:friendsSnapshot.size};
}

module.exports={REAUTH_WINDOW_SECONDS,isRecentSignIn,deleteAccountData};

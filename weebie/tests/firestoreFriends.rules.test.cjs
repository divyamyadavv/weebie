const test=require("node:test");
const assert=require("node:assert/strict");
const {friendConversationId,roomInvitationId,respondToRoomInvitation}=require("../functions/friendSystem.cjs");
const {executeFriendRequest}=require("../lib/friendRequestApi.cjs");
const {activePresenceUids,activeRoomMemberRecords,replacementPresenceSession}=require("../lib/presenceSessions.cjs");
const {summarizeActiveRoom,getActiveRoomsForUser}=require("../lib/activeRooms.cjs");
const {authorizeRoomVideo}=require("../lib/roomVideoAccess.cjs");
const {reconcileRoomLeadership}=require("../functions/roomLeadership.cjs");
const {getRoomEntryDecision}=require("../lib/roomAccess.cjs");

const emulatorReady=!!(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST);
const functionsEmulatorTests=process.env.WEEBIE_FUNCTIONS_EMULATOR_TESTS==="true";

test("Firestore rules restrict friends, presence, conversations, and invitations to authorized users",{skip:!emulatorReady},async t=>{
 const clientSdk={
  app:require("firebase/app"),
  auth:require("firebase/auth"),
  firestore:require("firebase/firestore"),
  adminApp:require("firebase-admin/app"),
  adminAuth:require("firebase-admin/auth"),
  adminFirestore:require("firebase-admin/firestore")
 };
 const projectId="demo-weebie-local",clientApp=clientSdk.app.initializeApp({apiKey:"emulator-test-key",authDomain:`${projectId}.firebaseapp.com`,projectId},`rules-test-${Date.now()}`),adminApp=clientSdk.adminApp.initializeApp({projectId},`rules-admin-${Date.now()}`),auth=clientSdk.auth.getAuth(clientApp),db=clientSdk.firestore.getFirestore(clientApp),admin=clientSdk.adminFirestore.getFirestore(adminApp),adminAuth=clientSdk.adminAuth.getAuth(adminApp),host=process.env.FIRESTORE_EMULATOR_HOST.split(":")[0],firestorePort=Number(process.env.FIRESTORE_EMULATOR_HOST.split(":")[1]);
 clientSdk.auth.connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
 clientSdk.firestore.connectFirestoreEmulator(db,host,firestorePort);
 const users=[],emails=new Map(),roomIds=[];
 const createUser=async label=>{
  const email=`${label}-${Date.now()}-${Math.random()}@example.test`,credential=await clientSdk.auth.createUserWithEmailAndPassword(auth,email,"Emulator-pass-123!");
  users.push(credential.user.uid);
  emails.set(credential.user.uid,email);
  await adminAuth.updateUser(credential.user.uid,{emailVerified:true});
  await credential.user.getIdToken(true);
  return credential.user.uid;
 };
 const signIn=async uid=>{
  await clientSdk.auth.signOut(auth).catch(()=>{});
  const credential=await clientSdk.auth.signInWithEmailAndPassword(auth,emails.get(uid),"Emulator-pass-123!");
  await credential.user.getIdToken(true);
 };
 const reference=(...path)=>clientSdk.firestore.doc(db,...path);
 const collection=(...path)=>clientSdk.firestore.collection(db,...path);
 const assertDenied=async operation=>assert.rejects(operation,error=>error.code==="permission-denied");
 try{
  const alice=await createUser("alice"),bob=await createUser("bob"),carol=await createUser("carol"),dave=await createUser("dave");
  const conversationId=friendConversationId(alice,bob),inviteId=`rules-invite-${Date.now()}`,roomId=`R${Date.now().toString(36).toUpperCase()}`,createdRoomId=`C${Date.now().toString(36).toUpperCase().slice(-10)}`;
  roomIds.push(roomId,createdRoomId);
  await admin.doc(`users/${alice}/friends/${bob}`).set({uid:bob});
  await admin.doc(`users/${bob}/friends/${alice}`).set({uid:alice});
  await admin.doc(`conversations/${conversationId}`).set({participants:[alice,bob],createdAt:new Date(),updatedAt:new Date()});
  await admin.doc(`conversations/${conversationId}/messages/hello`).set({senderUid:alice,text:"Private",createdAt:new Date()});
  await admin.doc(`roomInvitations/${inviteId}`).set({senderUid:alice,recipientUid:bob,roomId,roomName:"Rules room",status:"pending"});
  const requestId="a".repeat(64);
  await admin.doc(`friendRequests/${requestId}`).set({senderUid:bob,recipientUid:carol,status:"pending",createdAt:new Date()});
  await admin.doc(`rooms/${roomId}`).set({name:"Rules room",adminId:alice,hostId:alice,originalOwnerId:alice,source:{type:"drive",fileId:"video-file"},playing:true,time:123});
  await admin.doc(`rooms/${roomId}/members/${alice}`).set({uid:alice,kicked:false,online:true,sessionId:"session",lastSeen:new Date()});
  await admin.doc(`rooms/${roomId}/members/${bob}`).set({uid:bob,kicked:false,online:true,sessionId:"bob-session",lastSeen:new Date()});
  await admin.doc(`users/${alice}/friends/${carol}`).set({uid:carol});
  await admin.doc(`users/${carol}/friends/${alice}`).set({uid:alice});
  const carolInvitationId=roomInvitationId(alice,carol,roomId);
  await admin.doc(`roomInvitations/${carolInvitationId}`).set({senderUid:alice,recipientUid:carol,roomId,roomName:"Rules room",status:"pending"});
  const extraCarolInvitationId=`extra-${Date.now()}`;
  await admin.doc(`roomInvitations/${extraCarolInvitationId}`).set({senderUid:alice,recipientUid:carol,roomId,roomName:"Rules room",status:"pending"});

  await t.test("invitation acceptance creates only the invitee membership before room navigation",async()=>{
   const result=await executeFriendRequest({db:admin,user:{uid:carol,name:"Carol"},body:{operation:"respondInvite",invitationId:carolInvitationId,action:"accept"},serverTimestamp:()=>new Date()});
   assert.deepEqual(result,{status:"accepted",roomId});
   const member=await admin.doc(`rooms/${roomId}/members/${carol}`).get();
   assert.equal(member.data().uid,carol);
   assert.equal(member.data().name,"Carol");
   assert.equal(member.data().online,true);
   assert.equal(member.data().kicked,false);
   assert.equal(member.data().sessionId,null);
   assert.equal((await admin.doc(`rooms/${roomId}/members/${alice}`).get()).data().uid,alice);
   const room= (await admin.doc(`rooms/${roomId}`).get()).data();
   assert.equal(authorizeRoomVideo({uid:carol,room,member:member.data(),activeSession:false}).ok,false);
   assert.equal(authorizeRoomVideo({uid:dave,room,member:null}).ok,false);
   assert.equal((await admin.doc(`users/${carol}/rooms/${roomId}`).get()).data().code,roomId);
   await assert.rejects(()=>executeFriendRequest({db:admin,user:{uid:alice,name:"Alice"},body:{operation:"respondInvite",invitationId:carolInvitationId,action:"accept",uid:carol},serverTimestamp:()=>new Date()}));
   assert.deepEqual(await respondToRoomInvitation({db:admin,uid:carol,token:{name:"Carol"},invitationId:carolInvitationId,action:"accept",serverTimestamp:()=>new Date()}),{status:"accepted",roomId});
   assert.equal((await admin.doc(`rooms/${roomId}/members/${carol}`).get()).data().uid,carol);
  });

  await t.test("invitee's authenticated join activates the membership and loads room data",async()=>{
   await signIn(carol);
   const member=reference("rooms",roomId,"members",carol),session=reference("rooms",roomId,"presenceSessions",`${carol}_active`);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(member);
    assert.equal(snapshot.data().uid,carol);
    transaction.update(member,{online:true,sessionId:"active",lastSeen:clientSdk.firestore.serverTimestamp()});
   });
   await clientSdk.firestore.setDoc(session,{uid:carol,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   await executeFriendRequest({db:admin,user:{uid:carol,name:"Carol"},body:{operation:"roomJoined",roomId},serverTimestamp:()=>new Date()});
   assert.equal((await admin.doc(`roomInvitations/${extraCarolInvitationId}`).get()).data().status,"joined");
   const activeSession=(await admin.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",carol).get()).docs.some(item=>require("../lib/presenceSessions.cjs").isPresenceSessionActive(item.data()));
   assert.equal(authorizeRoomVideo({uid:carol,room:(await admin.doc(`rooms/${roomId}`).get()).data(),member:(await admin.doc(`rooms/${roomId}/members/${carol}`).get()).data(),activeSession}).ok,true);
   assert.equal(summarizeActiveRoom(roomId,{name:"Rules room"},[{id:carol,data:(await admin.doc(`rooms/${roomId}/members/${carol}`).get()).data()}],(await admin.collection(`rooms/${roomId}/presenceSessions`).get()).docs.map(item=>({...item.data(),documentId:item.id})),Date.now(),carol).members,1);
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("rooms",roomId))).exists(),true);
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("rooms",roomId))).data().source.fileId,"video-file");
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members"))).size,3);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"presenceSessions"))).size,1);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"messages"))).size,0);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(member);
    assert.equal(snapshot.data().uid,carol);
    transaction.update(member,{online:true,sessionId:"active-again",lastSeen:clientSdk.firestore.serverTimestamp()});
   });
   await clientSdk.firestore.setDoc(reference("rooms",roomId,"presenceSessions",`${carol}_active-again`),{uid:carol,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members"))).size,3);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"presenceSessions"))).size,2);
   const roomSummary=await getActiveRoomsForUser(admin,carol);
   assert.equal(roomSummary.activeRooms[0].members,1);
   assert.equal(roomSummary.activeRooms[0].activeMembers[0].name,"Carol");
   await clientSdk.firestore.deleteDoc(reference("rooms",roomId,"presenceSessions",`${carol}_active-again`));
   await clientSdk.firestore.updateDoc(member,{online:true,sessionId:"active",lastSeen:clientSdk.firestore.serverTimestamp()});
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"presenceSessions"))).size,1);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members"))).size,3,"the remaining tab keeps member access");
   await clientSdk.firestore.deleteDoc(reference("rooms",roomId,"presenceSessions",`${carol}_active`));
   assert.equal((await admin.collection(`rooms/${roomId}/presenceSessions`).where("uid","==",carol).get()).size,0);
   assert.equal((await admin.doc(`rooms/${roomId}`).get()).exists,true,"last-member leave preserves the room document");
   assert.equal((await getActiveRoomsForUser(admin,carol)).activeRooms.length,0);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members")));
  });

  await t.test("non-members cannot load room members, messages, or presence sessions",async()=>{
   await signIn(dave);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members")));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"messages")));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"presenceSessions")));
  });

  await t.test("a kicked UID can rejoin only after a fresh invitation from the room admin",async()=>{
   await admin.doc(`rooms/${roomId}/presenceSessions/${alice}_session`).set({uid:alice,online:true,lastSeen:new Date()});
   const email=`kicked-reinvite-${Date.now()}@example.test`,kicked=await adminAuth.createUser({email,password:"Emulator-pass-123!",emailVerified:true});
   users.push(kicked.uid);emails.set(kicked.uid,email);
   await admin.doc(`users/${alice}/friends/${kicked.uid}`).set({uid:kicked.uid});
   await admin.doc(`users/${kicked.uid}/friends/${alice}`).set({uid:alice});
   await admin.doc(`users/${kicked.uid}/rooms/${roomId}`).set({code:roomId,name:"Rules room",joinedAt:new Date()});
   await admin.doc(`rooms/${roomId}/members/${kicked.uid}`).set({uid:kicked.uid,name:"Kicked",online:true,kicked:false,sessionId:"old",lastSeen:new Date()});
   await admin.doc(`rooms/${roomId}/presenceSessions/${kicked.uid}_old`).set({uid:kicked.uid,online:true,lastSeen:new Date()});
   await admin.doc(`rooms/${roomId}/members/${dave}`).set({uid:dave,name:"Other kicked member",online:false,kicked:true});
   const oldInvitationId=roomInvitationId(alice,kicked.uid,roomId);
   await admin.doc(`roomInvitations/${oldInvitationId}`).set({senderUid:alice,recipientUid:kicked.uid,roomId,status:"pending"});
   assert.deepEqual(await executeFriendRequest({
    db:admin,user:{uid:alice,name:"Alice"},
    body:{operation:"kickRoomMember",roomId,targetUid:kicked.uid},
    serverTimestamp:()=>new Date()
   }),{status:"kicked"});
   assert.equal((await admin.doc(`rooms/${roomId}/members/${kicked.uid}`).get()).data().kicked,true);
   assert.equal((await admin.doc(`rooms/${roomId}/presenceSessions/${kicked.uid}_old`).get()).exists,false);
   assert.equal((await getRoomEntryDecision(admin,roomId,kicked.uid)).code,"ROOM_KICKED");
   assert.equal((await admin.doc(`rooms/${roomId}/presenceSessions/${kicked.uid}_direct-link`).get()).exists,false);
   assert.equal((await getRoomEntryDecision(admin,roomId,dave)).code,"ROOM_KICKED");
   const kickedRoomSummary=await getActiveRoomsForUser(admin,kicked.uid);
   assert.equal(kickedRoomSummary.activeRooms[0].code,roomId);
   assert.equal(kickedRoomSummary.activeRooms[0].members,1);
   assert.deepEqual(kickedRoomSummary.activeRooms[0].activeMembers,[]);
   assert.equal((await admin.doc(`users/${kicked.uid}/rooms/${roomId}`).get()).exists,true);

   await signIn(kicked.uid);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members")));
   await assertDenied(()=>clientSdk.firestore.updateDoc(reference("rooms",roomId,"members",kicked.uid),{kicked:false,online:true}));
   await assert.rejects(()=>executeFriendRequest({
    db:admin,user:{uid:kicked.uid,name:"Kicked"},
    body:{operation:"respondInvite",invitationId:oldInvitationId,action:"accept"},
    serverTimestamp:()=>new Date()
   }),/no longer pending/);
   assert.equal((await admin.doc(`roomInvitations/${oldInvitationId}`).get()).data().status,"revoked");

   const nonAdminEmail=`room-member-${Date.now()}@example.test`,nonAdmin=await adminAuth.createUser({email:nonAdminEmail,password:"Emulator-pass-123!",emailVerified:true});
   users.push(nonAdmin.uid);emails.set(nonAdmin.uid,nonAdminEmail);
   await admin.doc(`users/${nonAdmin.uid}/friends/${kicked.uid}`).set({uid:kicked.uid});
   await admin.doc(`users/${kicked.uid}/friends/${nonAdmin.uid}`).set({uid:nonAdmin.uid});
   await admin.doc(`rooms/${roomId}/members/${nonAdmin.uid}`).set({uid:nonAdmin.uid,name:"Member",online:true,kicked:false,sessionId:"active",lastSeen:new Date()});
   await admin.doc(`rooms/${roomId}/presenceSessions/${nonAdmin.uid}_active`).set({uid:nonAdmin.uid,online:true,lastSeen:new Date()});
   await assert.rejects(()=>executeFriendRequest({
    db:admin,user:{uid:nonAdmin.uid,name:"Member"},
    body:{operation:"kickRoomMember",roomId,targetUid:kicked.uid},
    serverTimestamp:()=>new Date()
   }),/Only the room admin/);
   await assert.rejects(()=>executeFriendRequest({
    db:admin,user:{uid:nonAdmin.uid,name:"Member"},
    body:{operation:"invite",friendUid:kicked.uid,roomId},
    serverTimestamp:()=>new Date()
   }),/Only the room admin/);

   const invite=await executeFriendRequest({
    db:admin,user:{uid:alice,name:"Alice"},
    body:{operation:"invite",friendUid:kicked.uid,roomId},
    serverTimestamp:()=>new Date()
   });
   assert.equal(invite.status,"sent");
   assert.notEqual(invite.invitationId,oldInvitationId);
   assert.equal((await admin.doc(`rooms/${roomId}/members/${kicked.uid}`).get()).data().kicked,true);
   const duplicate=await executeFriendRequest({
    db:admin,user:{uid:alice,name:"Alice"},
    body:{operation:"invite",friendUid:kicked.uid,roomId},
    serverTimestamp:()=>new Date()
   });
   assert.deepEqual(duplicate,{status:"pending",invitationId:invite.invitationId});
   await executeFriendRequest({
    db:admin,user:{uid:kicked.uid,name:"Kicked"},
    body:{operation:"respondInvite",invitationId:invite.invitationId,action:"accept"},
    serverTimestamp:()=>new Date()
   });
   const repaired=(await admin.doc(`rooms/${roomId}/members/${kicked.uid}`).get()).data();
   assert.equal(repaired.kicked,false);
   assert.equal(repaired.online,false);
   assert.equal(repaired.sessionId,null);
   assert.equal(repaired.reinviteInvitationId,null);
   assert.equal((await admin.doc(`rooms/${roomId}/presenceSessions/${kicked.uid}_old`).get()).exists,false);
   assert.equal((await getRoomEntryDecision(admin,roomId,kicked.uid)).allowed,true);
   assert.equal((await getRoomEntryDecision(admin,roomId,dave)).code,"ROOM_KICKED");
   assert.equal((await admin.doc(`rooms/${roomId}/members/${dave}`).get()).data().kicked,true);

   await admin.doc(`rooms/${roomId}/presenceSessions/${alice}_admin-kick-check`).set({uid:alice,online:true,lastSeen:new Date()});
   await signIn(alice);
   await assertDenied(()=>clientSdk.firestore.updateDoc(reference("rooms",roomId,"members",dave),{kicked:false,online:true}));
   await assertDenied(()=>clientSdk.firestore.updateDoc(reference("rooms",roomId,"members",carol),{kicked:true,online:false}));
   await signIn(kicked.uid);
   const member=reference("rooms",roomId,"members",kicked.uid),session=reference("rooms",roomId,"presenceSessions",`${kicked.uid}_fresh`);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(member);
    assert.equal(snapshot.data().kicked,false);
    transaction.update(member,{online:true,sessionId:"fresh",lastSeen:clientSdk.firestore.serverTimestamp()});
   });
   await clientSdk.firestore.setDoc(session,{uid:kicked.uid,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members"))).docs.some(item=>item.id===kicked.uid),true);
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("rooms",roomId))).exists(),true);
   const rejoinedRooms=await getActiveRoomsForUser(admin,kicked.uid);
   assert.ok(rejoinedRooms.activeRooms[0].members>=2);
   assert.equal(rejoinedRooms.activeRooms[0].members,rejoinedRooms.activeRooms[0].activeMembers.length);
   assert.equal(rejoinedRooms.activeRooms[0].activeMembers.some(item=>item.name==="Kicked"),true);
   await admin.doc(`rooms/${roomId}/presenceSessions/${alice}_session`).delete();
   await admin.doc(`rooms/${roomId}/presenceSessions/${alice}_admin-kick-check`).delete();
  });

  await t.test("expired membership cannot read room content until a fresh session is registered",async()=>{
   const staleId=`stale${Date.now()}`,staleEmail=`${staleId}@example.test`,stale=await adminAuth.createUser({email:staleEmail,password:"Emulator-pass-123!",emailVerified:true});
   users.push(stale.uid);emails.set(stale.uid,staleEmail);
   await admin.doc(`rooms/${roomId}/members/${stale.uid}`).set({uid:stale.uid,name:"Stale",online:true,kicked:false,lastSeen:new Date(Date.now()-120000)});
   await signIn(stale.uid);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members")));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"messages")));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"presenceSessions")));
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("rooms",roomId,"members",stale.uid))).exists(),true);
   const kickedEmail=`kicked-${Date.now()}@example.test`,kicked=await adminAuth.createUser({email:kickedEmail,password:"Emulator-pass-123!",emailVerified:true});
   users.push(kicked.uid);emails.set(kicked.uid,kickedEmail);
   await admin.doc(`rooms/${roomId}/members/${kicked.uid}`).set({uid:kicked.uid,name:"Kicked",online:true,kicked:true,sessionId:"kicked-session",lastSeen:new Date()});
   await admin.doc(`rooms/${roomId}/presenceSessions/${kicked.uid}_kicked-session`).set({uid:kicked.uid,online:true,lastSeen:new Date()});
   await signIn(kicked.uid);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"members")));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",roomId,"messages")));
  });

  await t.test("actual room creation transaction writes the room, member, and My Rooms index",async()=>{
   const room=reference("rooms",createdRoomId),owner=reference("rooms",createdRoomId,"members",alice),index=reference("users",alice,"rooms",createdRoomId);
   await signIn(alice);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    transaction.set(room,{code:createdRoomId,name:"Created by client",hostId:alice,adminId:alice,ownerUid:alice,originalOwnerId:alice,voluntaryTransfer:false,source:null,playing:false,time:0,playbackRate:1,eventTimestamp:Date.now(),eventType:"source",controllerId:alice,createdAt:clientSdk.firestore.serverTimestamp(),updatedAt:clientSdk.firestore.serverTimestamp()});
    transaction.set(owner,{uid:alice,name:"Alice",online:true,muted:true,speaking:false,sessionId:"create-session",joinSequence:1,joinedAt:clientSdk.firestore.serverTimestamp(),lastSeen:clientSdk.firestore.serverTimestamp(),kicked:false});
    transaction.set(index,{code:createdRoomId,name:"Created by client",joinedAt:clientSdk.firestore.serverTimestamp()});
   });
   assert.equal((await clientSdk.firestore.getDocFromServer(room)).exists(),true);
   assert.equal((await clientSdk.firestore.getDocFromServer(owner)).data().uid,alice);
   assert.equal((await clientSdk.firestore.getDocFromServer(index)).exists(),true);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("users",alice,"rooms"))).size,1);
  });

  await t.test("room join creates the member and index, then permits roster and presence subscriptions",async()=>{
   const joinedRoomId=createdRoomId,room=reference("rooms",joinedRoomId),member=reference("rooms",joinedRoomId,"members",bob),index=reference("users",bob,"rooms",joinedRoomId),session=reference("rooms",joinedRoomId,"presenceSessions",`${bob}_join-session`);
   await signIn(bob);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    assert.equal((await transaction.get(room)).exists(),true);
    transaction.set(member,{uid:bob,name:"Bob",online:true,muted:true,speaking:false,sessionId:"join-session",joinSequence:2,joinedAt:clientSdk.firestore.serverTimestamp(),lastSeen:clientSdk.firestore.serverTimestamp(),kicked:false});
    transaction.set(index,{code:joinedRoomId,name:"Created by client",joinedAt:clientSdk.firestore.serverTimestamp()});
   });
   await clientSdk.firestore.setDoc(session,{uid:bob,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   const roster=await clientSdk.firestore.getDocsFromServer(collection("rooms",joinedRoomId,"members"));
   const sessions=await clientSdk.firestore.getDocsFromServer(collection("rooms",joinedRoomId,"presenceSessions"));
   assert.equal(roster.size,2);
   assert.equal(sessions.size,1);
   assert.equal(activePresenceUids(sessions.docs.map(item=>item.data())).has(bob),true);
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("rooms",joinedRoomId))).exists(),true);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("users",bob,"rooms"))).size,1);
  });

  await t.test("room leadership transfer requires fresh admin and target presence",async()=>{
   const room=reference("rooms",createdRoomId),aliceMember=reference("rooms",createdRoomId,"members",alice),aliceSession=reference("rooms",createdRoomId,"presenceSessions",`${alice}_create-session`),bobMember=reference("rooms",createdRoomId,"members",bob),bobSession=reference("rooms",createdRoomId,"presenceSessions",`${bob}_join-session`);
   const refreshPresence=async(uid,member,session)=>{
    await signIn(uid);
    await clientSdk.firestore.runTransaction(db,async transaction=>{
     const memberSnapshot=await transaction.get(member);
     transaction.update(member,{online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
     if(uid===alice&&!memberSnapshot.data().sessionId)throw new Error("The transfer fixture has no admin session.");
     transaction.set(session,{uid,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
    });
   };
   await refreshPresence(alice,aliceMember,aliceSession);
   await refreshPresence(bob,bobMember,bobSession);
   await signIn(alice);
   await admin.doc(`rooms/${createdRoomId}/members/${alice}`).update({lastSeen:new Date(Date.now()-90000)});
   await admin.doc(`rooms/${createdRoomId}/presenceSessions/${alice}_create-session`).update({lastSeen:new Date(Date.now()-90000)});
   const transfer=()=>clientSdk.firestore.runTransaction(db,async transaction=>{
    const [roomSnapshot,targetSnapshot,targetSessionSnapshot]=await Promise.all([transaction.get(room),transaction.get(bobMember),transaction.get(bobSession)]);
    assert.equal(roomSnapshot.data().adminId,alice);
    assert.equal(targetSnapshot.data().sessionId,"join-session");
    assert.equal(targetSessionSnapshot.exists(),true);
    transaction.update(room,{adminId:bob,ownerUid:bob,voluntaryTransfer:true,controllerId:alice,eventTimestamp:Date.now(),eventType:"admin-transfer",updatedAt:clientSdk.firestore.serverTimestamp()});
   });
   await assertDenied(transfer);
   await refreshPresence(alice,aliceMember,aliceSession);
   await refreshPresence(bob,bobMember,bobSession);
   await signIn(alice);
   await transfer();
   const updatedRoom=(await clientSdk.firestore.getDocFromServer(room)).data();
   assert.equal(updatedRoom.adminId,bob);
   assert.equal(updatedRoom.ownerUid,bob);
   assert.equal(updatedRoom.voluntaryTransfer,true);
   await admin.doc(`rooms/${createdRoomId}/presenceSessions/${alice}_create-session`).delete();
   await admin.doc(`rooms/${createdRoomId}/presenceSessions/${bob}_join-session`).delete();
   await admin.doc(`rooms/${createdRoomId}`).update({adminId:alice,ownerUid:alice,voluntaryTransfer:false,controllerId:alice});
  });

  await t.test("active room listeners stay authorized across server-timestamp heartbeats",async()=>{
   const liveRoomId=`LIVE${Date.now().toString(36).toUpperCase().slice(-8)}`;
   const member=reference("rooms",liveRoomId,"members",alice),session=reference("rooms",liveRoomId,"presenceSessions",`${alice}_listener`);
   await admin.doc(`rooms/${liveRoomId}`).set({name:"Live listener",adminId:alice,hostId:alice,ownerUid:alice,originalOwnerId:alice});
   await admin.doc(`rooms/${liveRoomId}/members/${alice}`).set({uid:alice,name:"Alice",online:true,kicked:false,sessionId:"listener",lastSeen:new Date()});
   await admin.doc(`rooms/${liveRoomId}/presenceSessions/${alice}_listener`).set({uid:alice,online:true,lastSeen:new Date()});
   await signIn(alice);

   const errors=[],snapshots=new Map(),unsubscribers=[];
   const ready=new Set();
   let markReady;
   const initialSnapshots=new Promise(resolve=>{markReady=resolve});
   for(const collectionName of ["members","presenceSessions","messages"]){
    const listener=clientSdk.firestore.onSnapshot(
     collection("rooms",liveRoomId,collectionName),
     snapshot=>{
      snapshots.set(collectionName,snapshot.size);
      ready.add(collectionName);
      if(ready.size===3)markReady();
     },
     error=>errors.push({collectionName,code:error.code})
    );
    unsubscribers.push(listener);
   }

   try{
    await Promise.race([
     initialSnapshots,
     new Promise((_,reject)=>setTimeout(()=>reject(new Error("Room listeners did not initialize")),10000))
    ]);
    for(let heartbeat=0;heartbeat<4;heartbeat++){
     await clientSdk.firestore.runTransaction(db,async transaction=>{
      transaction.update(member,{lastSeen:clientSdk.firestore.serverTimestamp()});
      transaction.update(session,{lastSeen:clientSdk.firestore.serverTimestamp()});
     });
     await new Promise(resolve=>setTimeout(resolve,10000));
    }
    assert.deepEqual(errors,[]);
    assert.equal(snapshots.get("members"),1);
    assert.equal(snapshots.get("presenceSessions"),1);
    await assertDenied(()=>clientSdk.firestore.updateDoc(member,{lastSeen:new Date(Date.now()+120000)}));
    await assertDenied(()=>clientSdk.firestore.updateDoc(session,{lastSeen:new Date(Date.now()+120000)}));
   }finally{
    unsubscribers.forEach(unsubscribe=>unsubscribe());
    await admin.recursiveDelete(admin.doc(`rooms/${liveRoomId}`));
   }
  });

  await t.test("reconciling expired Firestore leases marks the room Past in My Rooms",{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
   const {initializeApp}=require("firebase-admin/app");
   const {getFirestore}=require("firebase-admin/firestore");
   const {PRESENCE_STALE_AFTER_MS}=require("../lib/presenceSessions.cjs");
   const app=initializeApp({projectId:"demo-weebie-local"},`stale-room-${Date.now()}`);
   const db=getFirestore(app),uid=`stale-room-user-${Date.now()}`,roomId=`S${Date.now().toString(36).toUpperCase()}`;
   const roomRef=db.doc(`rooms/${roomId}`),memberRef=db.doc(`rooms/${roomId}/members/${uid}`);
   const sessionRef=db.doc(`rooms/${roomId}/presenceSessions/${uid}_closed-tab`);
   try{
    const staleTime=new Date(Date.now()-PRESENCE_STALE_AFTER_MS-1000),now=new Date();
    await roomRef.set({code:roomId,name:"Stale lease regression",hostId:uid,adminId:uid,ownerUid:uid,originalOwnerId:uid,voluntaryTransfer:false,createdAt:now});
    await memberRef.set({uid,name:"Stale member",online:true,kicked:false,sessionId:"closed-tab",joinSequence:1,joinedAt:now,lastSeen:staleTime});
    await sessionRef.set({uid,online:true,lastSeen:staleTime});
    await db.doc(`users/${uid}/rooms/${roomId}`).set({code:roomId,name:"Stale lease regression",joinedAt:now});

    const result=await reconcileRoomLeadership(db,roomId);
    assert.equal(result.adminId,null);
    assert.equal((await sessionRef.get()).data().online,false);
    const member=(await memberRef.get()).data();
    assert.equal(member.online,false);
    assert.equal(member.sessionId,null);
    const {activeRooms,pastRooms}=await getActiveRoomsForUser(db,uid);
    assert.deepEqual(activeRooms,[]);
    assert.equal(pastRooms.length,1);
    assert.equal(pastRooms[0].code,roomId);
   }finally{
    await db.recursiveDelete(roomRef).catch(()=>{});
    await db.doc(`users/${uid}/rooms/${roomId}`).delete().catch(()=>{});
    await app.delete();
   }
  });

  await t.test("a fresh lease counts consistently when Firestore member lastSeen is awaiting repair",{skip:!process.env.FIRESTORE_EMULATOR_HOST},async()=>{
   const {initializeApp}=require("firebase-admin/app");
   const {getFirestore}=require("firebase-admin/firestore");
   const app=initializeApp({projectId:"demo-weebie-local"},`live-room-roster-${Date.now()}`);
   const db=getFirestore(app),uid=`live-room-user-${Date.now()}`,roomId=`L${Date.now().toString(36).toUpperCase()}`;
   const roomRef=db.doc(`rooms/${roomId}`),memberRef=db.doc(`rooms/${roomId}/members/${uid}`);
   const sessionRef=db.doc(`rooms/${roomId}/presenceSessions/${uid}_active-tab`);
   try{
    const now=Date.now(),createdAt=new Date(now);
    await roomRef.set({code:roomId,name:"Live lease regression",hostId:uid,adminId:uid,ownerUid:uid,originalOwnerId:uid,voluntaryTransfer:false,createdAt});
    await memberRef.set({uid,name:"Live member",photoURL:"https://images.test/live-member.png",online:true,kicked:false,sessionId:"active-tab",joinSequence:1,joinedAt:createdAt,lastSeen:new Date(now-75001)});
    await sessionRef.set({uid,online:true,lastSeen:createdAt});
    await db.doc(`users/${uid}/rooms/${roomId}`).set({code:roomId,name:"Live lease regression",joinedAt:createdAt});

    const storedMember=(await memberRef.get()).data(),storedSession=(await sessionRef.get()).data();
    const rosterBeforeRepair=activeRoomMemberRecords(
     [{id:uid,data:storedMember}],
     [{...storedSession,documentId:sessionRef.id}],
     now
    );
    assert.equal(rosterBeforeRepair.length,1);
    assert.equal(rosterBeforeRepair[0].name,"Live member");

    await reconcileRoomLeadership(db,roomId,{now});
    const {activeRooms}=await getActiveRoomsForUser(db,uid,now);
    assert.equal(activeRooms[0].members,1);
    assert.equal(activeRooms[0].activeMembers[0].name,"Live member");
    const repairedMember=(await memberRef.get()).data();
    const repairedSession=(await sessionRef.get()).data();
    assert.equal(activeRoomMemberRecords(
     [{id:uid,data:repairedMember}],
     [{...repairedSession,documentId:sessionRef.id}],
     now
    ).length,activeRooms[0].members);
   }finally{
    await db.recursiveDelete(roomRef).catch(()=>{});
    await db.doc(`users/${uid}/rooms/${roomId}`).delete().catch(()=>{});
    await app.delete();
   }
  });

  await t.test("a user cannot forge a My Rooms index without room membership",async()=>{
   await signIn(carol);
   await assertDenied(()=>clientSdk.firestore.setDoc(reference("users",carol,"rooms",createdRoomId),{code:createdRoomId,name:"Forged membership"}));
  });

  await t.test("friend-request queries are limited to the sender or recipient",async()=>{
   await signIn(bob);
   const outgoing=clientSdk.firestore.query(collection("friendRequests"),clientSdk.firestore.where("senderUid","==",bob));
   assert.equal((await clientSdk.firestore.getDocsFromServer(outgoing)).size,1);
   await signIn(carol);
   const incoming=clientSdk.firestore.query(collection("friendRequests"),clientSdk.firestore.where("recipientUid","==",carol));
   assert.equal((await clientSdk.firestore.getDocsFromServer(incoming)).size,1);
   await signIn(alice);
   await assertDenied(()=>clientSdk.firestore.getDocFromServer(reference("friendRequests",requestId)));
  });

  await t.test("global presence initialization, heartbeat, and cleanup match owner-scoped rules",async()=>{
   const ownerSession=reference("users",alice,"presenceSessions","alice-presence-lifecycle");
   await signIn(alice);
   assert.equal((await clientSdk.firestore.getDocsFromServer(collection("users",alice,"presenceSessions"))).size,0);
   await clientSdk.firestore.setDoc(ownerSession,{uid:alice,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   await clientSdk.firestore.setDoc(ownerSession,{uid:alice,online:true,lastSeen:clientSdk.firestore.serverTimestamp()},{merge:true});
   await clientSdk.firestore.updateDoc(ownerSession,{online:false,lastSeen:clientSdk.firestore.serverTimestamp()});
   await clientSdk.firestore.deleteDoc(ownerSession);
   await assert.equal((await clientSdk.firestore.getDocFromServer(ownerSession)).exists(),false);
   await clientSdk.firestore.setDoc(ownerSession,{uid:alice,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
   await signIn(bob);
   assert.equal((await clientSdk.firestore.getDocFromServer(ownerSession)).data().online,true);
   await assertDenied(()=>clientSdk.firestore.updateDoc(ownerSession,{online:false,lastSeen:clientSdk.firestore.serverTimestamp()}));
   await assertDenied(()=>clientSdk.firestore.deleteDoc(ownerSession));
   await signIn(dave);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("users",alice,"presenceSessions")));
  });

  await signIn(alice);
  const alicePresence=reference("users",alice,"presenceSessions","alice-session");
  const roomPresence=reference("rooms",roomId,"presenceSessions",`${alice}_session`);
  await clientSdk.firestore.setDoc(alicePresence,{uid:alice,online:true,lastSeen:clientSdk.firestore.serverTimestamp()});
  await clientSdk.firestore.runTransaction(db,async transaction=>{
   const member=reference("rooms",roomId,"members",alice),lastSeen=clientSdk.firestore.serverTimestamp();
   transaction.update(member,{online:true,sessionId:"session",lastSeen});
   transaction.set(roomPresence,{uid:alice,online:true,lastSeen});
  });
  await t.test("session leases can be written by their owner and read by accepted friends and active room members",async()=>{
   assert.equal((await clientSdk.firestore.getDocFromServer(alicePresence)).data().online,true);
   await signIn(bob);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const member=reference("rooms",roomId,"members",bob),lastSeen=clientSdk.firestore.serverTimestamp();
    transaction.update(member,{online:true,sessionId:"bob-session",lastSeen});
    transaction.set(reference("rooms",roomId,"presenceSessions",`${bob}_bob-session`),{uid:bob,online:true,lastSeen});
   });
   const friendSessions=await clientSdk.firestore.getDocsFromServer(clientSdk.firestore.collection(db,"users",alice,"presenceSessions"));
   assert.ok(friendSessions.docs.some(item=>item.id==="alice-session"));
   assert.equal((await clientSdk.firestore.getDocFromServer(roomPresence)).exists(),true);
   await signIn(dave);
   await assertDenied(()=>clientSdk.firestore.getDocFromServer(alicePresence));
   await assertDenied(()=>clientSdk.firestore.getDocFromServer(roomPresence));
   await signIn(alice);
   await assert.equal((await clientSdk.firestore.getDocFromServer(alicePresence)).exists(),true);
   await signIn(bob);
   assert.equal((await clientSdk.firestore.getDocFromServer(alicePresence)).exists(),true);
  });

  await t.test("private messages and invitations are readable only by their participants",async()=>{
   await signIn(bob);
   const messages=clientSdk.firestore.query(collection("conversations",conversationId,"messages"),clientSdk.firestore.orderBy("createdAt","asc"),clientSdk.firestore.limitToLast(100));
   assert.equal((await clientSdk.firestore.getDocsFromServer(messages)).size,1);
   assert.equal((await clientSdk.firestore.getDocFromServer(reference("roomInvitations",inviteId))).exists(),true);
   assert.equal((await clientSdk.firestore.getDocsFromServer(clientSdk.firestore.query(collection("roomInvitations"),clientSdk.firestore.where("recipientUid","==",bob)))).size,1);
   await signIn(carol);
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(messages));
   await assertDenied(()=>clientSdk.firestore.getDocFromServer(reference("roomInvitations",inviteId)));
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(clientSdk.firestore.query(collection("roomInvitations"),clientSdk.firestore.where("recipientUid","==",bob))));
  });

  await t.test("clients cannot mutate friendships, blocks, chat messages, or invitations",async()=>{
   await signIn(alice);
   await assertDenied(()=>clientSdk.firestore.setDoc(reference("users",alice,"friends",carol),{uid:carol}));
   await assertDenied(()=>clientSdk.firestore.setDoc(reference("users",alice,"blocks",carol),{blockedUid:carol}));
   await assertDenied(()=>clientSdk.firestore.setDoc(reference("conversations",conversationId,"messages","forged"),{senderUid:alice,text:"Forged",createdAt:clientSdk.firestore.serverTimestamp()}));
   await assertDenied(()=>clientSdk.firestore.setDoc(reference("roomInvitations","forged"),{senderUid:alice,recipientUid:carol,roomId,status:"pending"}));
  });

  await t.test("blocking or deleting reciprocal friendship revokes conversation and presence access",async()=>{
   await signIn(bob);
   await admin.doc(`users/${alice}/blocks/${bob}`).set({blockedUid:bob});
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(clientSdk.firestore.collection(db,"conversations",conversationId,"messages")));
   await assertDenied(()=>clientSdk.firestore.getDocFromServer(alicePresence));
   await admin.doc(`users/${alice}/blocks/${bob}`).delete();
   await admin.doc(`users/${bob}/friends/${alice}`).delete();
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(clientSdk.firestore.collection(db,"conversations",conversationId,"messages")));
  });

  await t.test("Firestore transactions persist transfer and restore only the persistent owner",async()=>{
   const room=reference("rooms",createdRoomId),bobMember=reference("rooms",createdRoomId,"members",bob);
   await admin.doc(`rooms/${createdRoomId}/members/${alice}`).update({sessionId:"owner-live",lastSeen:new Date()});
   await admin.doc(`rooms/${createdRoomId}/members/${bob}`).update({sessionId:"bob-live",lastSeen:new Date()});
   const aliceSession=admin.doc(`rooms/${createdRoomId}/presenceSessions/${alice}_owner-live`);
   await aliceSession.set({uid:alice,online:true,lastSeen:new Date()});
   await admin.doc(`rooms/${createdRoomId}/presenceSessions/${bob}_bob-live`).set({uid:bob,online:true,lastSeen:new Date()});
   const waitForAdmin=async expected=>{
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
     if((await admin.doc(`rooms/${createdRoomId}`).get()).data()?.adminId===expected)return;
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal((await admin.doc(`rooms/${createdRoomId}`).get()).data()?.adminId,expected);
   };
   const assertAdmin=async expected=>{
    if(functionsEmulatorTests)await waitForAdmin(expected);
    else assert.equal((await reconcileRoomLeadership(admin,createdRoomId)).adminId,expected);
   };
   await assertAdmin(alice);
   await aliceSession.delete();
   await assertAdmin(bob);
   await signIn(bob);
   await clientSdk.firestore.updateDoc(room,{
    playing:true,time:0,controllerId:bob,eventTimestamp:Date.now(),eventType:"pause",updatedAt:clientSdk.firestore.serverTimestamp()
   });
   assert.equal((await admin.doc(`rooms/${createdRoomId}`).get()).data().playing,true);
   await assertDenied(()=>clientSdk.firestore.updateDoc(room,{
    playing:false,time:0,controllerId:alice,eventTimestamp:Date.now(),eventType:"play"
   }));
   const aliceReturnSession=admin.doc(`rooms/${createdRoomId}/presenceSessions/${alice}_owner-returned`);
   await aliceReturnSession.set({uid:alice,online:true,lastSeen:new Date()});
   await admin.doc(`rooms/${createdRoomId}/members/${alice}`).update({online:true,sessionId:"owner-returned",lastSeen:new Date()});
   await assertAdmin(alice);
   await signIn(alice);
   await assertDenied(()=>clientSdk.firestore.updateDoc(room,{
    adminId:dave,ownerUid:dave,voluntaryTransfer:true,controllerId:alice,
    eventTimestamp:Date.now(),eventType:"admin-transfer",updatedAt:clientSdk.firestore.serverTimestamp()
   }));
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const [roomSnapshot,targetSnapshot]=await Promise.all([transaction.get(room),transaction.get(bobMember)]);
    assert.equal(roomSnapshot.data().adminId,alice);
    assert.equal(targetSnapshot.data().kicked,false);
    transaction.update(room,{adminId:bob,ownerUid:bob,voluntaryTransfer:true,controllerId:alice,eventTimestamp:Date.now(),eventType:"admin-transfer",updatedAt:clientSdk.firestore.serverTimestamp()});
   });
   assert.equal((await clientSdk.firestore.getDocFromServer(room)).data().ownerUid,bob);
   await assertDenied(()=>clientSdk.firestore.updateDoc(room,{adminId:alice,ownerUid:alice,voluntaryTransfer:true,controllerId:alice,eventTimestamp:Date.now(),eventType:"admin-transfer"}));
   await aliceSession.delete();
   await aliceReturnSession.delete();
   await assertAdmin(bob);
   await aliceReturnSession.set({uid:alice,online:true,lastSeen:new Date()});
   await admin.doc(`rooms/${createdRoomId}/members/${alice}`).update({online:true,sessionId:"owner-returned",lastSeen:new Date()});
   await assertAdmin(bob);
   assert.equal((await admin.doc(`rooms/${createdRoomId}/members/${alice}`).get()).exists,true);
   assert.equal((await admin.doc(`rooms/${createdRoomId}/members/${bob}`).get()).exists,true);
  });

  await t.test("a departing latest tab atomically hands Firestore room authority to a remaining tab",async()=>{
   const leaseRoomId=`L${Date.now().toString(36).toUpperCase()}`,room=admin.doc(`rooms/${leaseRoomId}`);
   roomIds.push(leaseRoomId);
   await room.set({code:leaseRoomId,name:"Lease test",hostId:alice,originalOwnerId:alice,ownerUid:alice,adminId:alice,voluntaryTransfer:false,playing:false,time:0,playbackRate:1,eventTimestamp:Date.now(),eventType:"source",controllerId:alice});
   await admin.doc(`rooms/${leaseRoomId}/members/${alice}`).set({uid:alice,name:"Alice",online:true,kicked:false,sessionId:"tab-b",joinSequence:1,lastSeen:new Date()});
   await admin.doc(`rooms/${leaseRoomId}/members/${bob}`).set({uid:bob,name:"Bob",online:true,kicked:false,sessionId:"bob-tab",joinSequence:2,lastSeen:new Date()});
   await admin.doc(`rooms/${leaseRoomId}/presenceSessions/${alice}_tab-a`).set({uid:alice,online:true,lastSeen:new Date(Date.now()-1000)});
   await admin.doc(`rooms/${leaseRoomId}/presenceSessions/${alice}_tab-b`).set({uid:alice,online:true,lastSeen:new Date()});
   await admin.doc(`rooms/${leaseRoomId}/presenceSessions/${bob}_bob-tab`).set({uid:bob,online:true,lastSeen:new Date()});
   await signIn(alice);
   const member=reference("rooms",leaseRoomId,"members",alice),leaving=reference("rooms",leaseRoomId,"presenceSessions",`${alice}_tab-b`);
   const sessionsQuery=clientSdk.firestore.query(collection("rooms",leaseRoomId,"presenceSessions"),clientSdk.firestore.where("uid","==",alice));
   const sessionsSnapshot=await clientSdk.firestore.getDocsFromServer(sessionsQuery);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const [memberSnapshot,...sessions]=await Promise.all([transaction.get(member),...sessionsSnapshot.docs.map(item=>transaction.get(reference("rooms",leaseRoomId,"presenceSessions",item.id)))]);
    assert.equal(memberSnapshot.data().sessionId,"tab-b");
    const replacement=replacementPresenceSession(alice,"tab-b",sessions.map((item,index)=>({id:sessionsSnapshot.docs[index].id,data:item.data()})));
    assert.equal(replacement.sessionId,"tab-a");
    transaction.delete(leaving);
    transaction.update(member,{online:true,sessionId:replacement.sessionId,lastSeen:clientSdk.firestore.serverTimestamp()});
   });
   const roster=await clientSdk.firestore.getDocsFromServer(collection("rooms",leaseRoomId,"members"));
   assert.equal(roster.size,2);
   await clientSdk.firestore.updateDoc(reference("rooms",leaseRoomId),{playing:true,time:0,eventTimestamp:Date.now(),eventType:"pause",controllerId:alice});
   assert.equal((await admin.doc(`rooms/${leaseRoomId}`).get()).data().playing,true);

   const finalSessions=await clientSdk.firestore.getDocsFromServer(sessionsQuery);
   await clientSdk.firestore.runTransaction(db,async transaction=>{
    const [memberSnapshot,...sessions]=await Promise.all([transaction.get(member),...finalSessions.docs.map(item=>transaction.get(reference("rooms",leaseRoomId,"presenceSessions",item.id)))]);
    transaction.delete(reference("rooms",leaseRoomId,"presenceSessions",`${alice}_tab-a`));
    transaction.update(member,{online:false,sessionId:null,lastSeen:clientSdk.firestore.serverTimestamp()});
    assert.equal(memberSnapshot.data().sessionId,"tab-a");
    assert.equal(sessions.length,1);
   });
   await assertDenied(()=>clientSdk.firestore.getDocsFromServer(collection("rooms",leaseRoomId,"members")));
  });
 }finally{
  for(const roomId of roomIds)await admin.recursiveDelete(admin.doc(`rooms/${roomId}`)).catch(()=>{});
  for(const uid of users)await adminAuth.deleteUser(uid).catch(()=>{});
  await clientSdk.adminApp.deleteApp(adminApp);
  await clientSdk.app.deleteApp(clientApp);
 }
});

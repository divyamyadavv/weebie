const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {reconcileRoomLeadership}=require("../functions/roomLeadership.cjs");
const {activeRoomMemberRecords,needsRoomMemberReconciliation,replacementPresenceSession}=require("../lib/presenceSessions.cjs");
const {summarizeActiveRoom}=require("../lib/activeRooms.cjs");

const now=1_700_000_000_000;

class FirestoreTimestamp{
 constructor(milliseconds){this.milliseconds=milliseconds}
 toMillis(){return this.milliseconds}
}

class MemoryFirestore{
 constructor(){this.records=new Map();this.pending=Promise.resolve()}
 doc(path){return {kind:"document",path,id:path.split("/").at(-1)}}
 collection(path){return {kind:"collection",path}}
 runTransaction(callback){
  const run=async()=>{
   const writes=[];
   const transaction={
    get:async ref=>{
     if(ref.kind==="document"){
      const value=this.records.get(ref.path);
      return {exists:this.records.has(ref.path),id:ref.id,data:()=>value};
     }
     const docs=[...this.records.entries()]
      .filter(([path])=>path.startsWith(`${ref.path}/`)&&!path.slice(ref.path.length+1).includes("/"))
      .map(([path,value])=>({id:path.split("/").at(-1),data:()=>value}));
     return {docs};
    },
    update:(ref,value)=>writes.push(()=>this.records.set(ref.path,{...this.records.get(ref.path),...value})),
    delete:ref=>writes.push(()=>this.records.delete(ref.path))
   };
   const result=await callback(transaction);
   writes.forEach(write=>write());
   return result;
  };
  const result=this.pending.then(run);
  this.pending=result.then(()=>{},()=>{});
  return result;
 }
 set(path,value){this.records.set(path,value)}
 delete(path){this.records.delete(path)}
}

function setup({ownerUid="owner",adminId=ownerUid,voluntaryTransfer=false}={}){
 const db=new MemoryFirestore(),roomId="LEAD01";
 db.set(`rooms/${roomId}`,{ownerUid,originalOwnerId:"owner",hostId:"owner",adminId,voluntaryTransfer,leadershipRevision:0});
 const addMember=(uid,joinSequence,{kicked=false,blocked=false,joinedAt=now+joinSequence}={})=>{
  db.set(`rooms/${roomId}/members/${uid}`,{uid,joinSequence,joinedAt:new Date(joinedAt),online:true,sessionId:uid,lastSeen:new Date(now),kicked,blocked});
 };
 const addSession=(uid,id=uid,lastSeen=now)=>db.set(`rooms/${roomId}/presenceSessions/${uid}_${id}`,{uid,online:true,lastSeen:new Date(lastSeen)});
 return {db,roomId,addMember,addSession};
}

test("original owner leaving selects the earliest active eligible member",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addMember("later",3);addMember("earliest",2);
 addSession("owner");addSession("later");addSession("earliest");
 db.delete(`rooms/${roomId}/presenceSessions/owner_owner`);
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,"earliest");
 assert.equal(db.records.get(`rooms/${roomId}`).ownerUid,"owner");
});

test("a departing temporary admin is succeeded by the earliest remaining active member",async()=>{
 const {db,roomId,addMember,addSession}=setup({adminId:"temporary"});
 addMember("owner",1);addMember("temporary",2);addMember("next",3);addMember("last",4);
 addSession("temporary");addSession("next");addSession("last");
 db.delete(`rooms/${roomId}/presenceSessions/temporary_temporary`);
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,"next");
});

test("the persistent owner regains admin after legitimately rejoining",async()=>{
 const {db,roomId,addMember,addSession}=setup({adminId:"temporary"});
 addMember("owner",1);addMember("temporary",2);addSession("owner");addSession("temporary");
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,"owner");
});

test("an explicitly transferred persistent owner remains admin when the former owner returns",async()=>{
 const {db,roomId,addMember,addSession}=setup({ownerUid:"recipient",adminId:"recipient",voluntaryTransfer:true});
 addMember("former-owner",1);addMember("recipient",2);addSession("former-owner");addSession("recipient");
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,"recipient");
 assert.equal(db.records.get(`rooms/${roomId}`).ownerUid,"recipient");
});

test("a former owner's heartbeat does not reclaim leadership after voluntary transfer",async()=>{
 const {db,roomId,addMember,addSession}=setup({ownerUid:"recipient",adminId:"recipient",voluntaryTransfer:true});
 addMember("former-owner",1);addMember("recipient",2);addSession("former-owner");addSession("recipient");
 const result=await reconcileRoomLeadership(db,roomId,{
  now,
  heartbeatSession:{uid:"former-owner",expectedUid:"former-owner",sessionId:"former-owner"}
 });
 const room=db.records.get(`rooms/${roomId}`);
 assert.equal(result.adminId,"recipient");
 assert.equal(room.adminId,"recipient");
 assert.equal(room.ownerUid,"recipient");
});

test("kicked, blocked, and removed members are never selected as successors",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addMember("kicked",2,{kicked:true});addMember("blocked",3,{blocked:true});addMember("removed",4,{joinedAt:now+4});
 db.records.get(`rooms/${roomId}/members/removed`).removed=true;
 addMember("eligible",5);
 addSession("kicked");addSession("blocked");addSession("removed");addSession("eligible");
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,"eligible");
});

test("simultaneous leave and rejoin reconciliation produces one admin",async()=>{
 const {db,roomId,addMember,addSession}=setup({adminId:"temporary"});
 addMember("owner",1);addMember("temporary",2);addSession("owner");addSession("temporary");
 db.delete(`rooms/${roomId}/presenceSessions/owner_owner`);
 await Promise.all([
  reconcileRoomLeadership(db,roomId,{now}),
  (async()=>{addSession("owner","returning");return reconcileRoomLeadership(db,roomId,{now})})()
 ]);
 const room=db.records.get(`rooms/${roomId}`);
 assert.equal(room.adminId,"owner");
 assert.ok(["owner","temporary"].includes(room.adminId));
});

test("the last active member leaving clears admin without assigning an invalid UID",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addSession("owner");
 db.delete(`rooms/${roomId}/presenceSessions/owner_owner`);
 const result=await reconcileRoomLeadership(db,roomId,{now});
 assert.equal(result.adminId,null);
 assert.equal(db.records.get(`rooms/${roomId}`).adminId,null);
});

test("expired leases do not qualify a member for succession",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addMember("stale",2);
 addSession("stale","old",now-75001);
 assert.equal((await reconcileRoomLeadership(db,roomId,{now})).adminId,null);
 assert.equal(db.records.get(`rooms/${roomId}/presenceSessions/stale_old`).online,false);
 assert.equal(db.records.get(`rooms/${roomId}/members/stale`).online,false);
 assert.equal(db.records.get(`rooms/${roomId}/members/stale`).sessionId,null);
});

test("a future-skewed member timestamp is repaired from its fresh session lease",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);
 addSession("owner","owner",now);
 db.records.get(`rooms/${roomId}/members/owner`).lastSeen=new Date(now+30001);
 const result=await reconcileRoomLeadership(db,roomId,{now});
 assert.equal(result.adminId,"owner");
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).lastSeen.getTime(),now);
});

test("a fresh secondary tab repairs a stale member session pointer before admin permission is assigned",async()=>{
 const {db,roomId,addMember,addSession}=setup({adminId:"owner"});
 addMember("owner",1);addMember("candidate",2);
 addSession("owner","active-tab");addSession("candidate","candidate-tab");
 db.records.get(`rooms/${roomId}/members/owner`).sessionId="closed-tab";
 db.records.get(`rooms/${roomId}/members/owner`).lastSeen=new Date(now-80000);
 const result=await reconcileRoomLeadership(db,roomId,{now});
 assert.equal(result.adminId,"owner");
 const repaired=db.records.get(`rooms/${roomId}/members/owner`);
 assert.equal(repaired.sessionId,"active-tab");
 assert.equal(repaired.online,true);
 assert.equal(repaired.lastSeen.getTime(),now);
});

test("My Rooms reconciliation repairs an active Firestore session the roster initially filters out",async()=>{
 const {db,roomId}=setup();
 const storedMember={
  uid:"owner",name:"Alice",photoURL:"https://images.test/alice.png",online:true,
  sessionId:"closed-tab",joinSequence:1,joinedAt:new FirestoreTimestamp(now-1000),
  lastSeen:new FirestoreTimestamp(now),kicked:false,blocked:false,removed:false
 };
 const storedSession={uid:"owner",online:true,lastSeen:new FirestoreTimestamp(now)};
 db.set(`rooms/${roomId}/members/owner`,storedMember);
 db.set(`rooms/${roomId}/presenceSessions/owner_active-tab`,storedSession);
 const memberRecords=[{id:"owner",data:storedMember}],sessionRecords=[{...storedSession,documentId:"owner_active-tab"}];
 assert.deepEqual(activeRoomMemberRecords(memberRecords,sessionRecords,now),[]);
 assert.equal(needsRoomMemberReconciliation(memberRecords[0],sessionRecords,now),true);
 assert.equal(summarizeActiveRoom(roomId,{name:"Watch"},memberRecords,sessionRecords,now),null);

 await reconcileRoomLeadership(db,roomId,{
  now,
  heartbeatSession:{uid:"owner",expectedUid:"owner",sessionId:"active-tab"}
 });

 const repairedMember=db.records.get(`rooms/${roomId}/members/owner`);
 const repairedSession=db.records.get(`rooms/${roomId}/presenceSessions/owner_active-tab`);
 const activeMembers=activeRoomMemberRecords(
  [{id:"owner",data:repairedMember}],
  [{...repairedSession,documentId:"owner_active-tab"}],
  now
 );
 assert.equal(repairedMember.sessionId,"active-tab");
 assert.equal(activeMembers.length,1);
 assert.equal(needsRoomMemberReconciliation({id:"owner",data:repairedMember},[{...repairedSession,documentId:"owner_active-tab"}],now),false);
 assert.deepEqual({name:activeMembers[0].name,photoURL:activeMembers[0].photoURL,online:activeMembers[0].online},{
  name:"Alice",photoURL:"https://images.test/alice.png",online:true
 });
 assert.equal(summarizeActiveRoom(roomId,{name:"Watch"},[{id:"owner",data:repairedMember}],[{...repairedSession,documentId:"owner_active-tab"}],now).members,1);
});

test("leaving one tab preserves the latest valid session pointer and final leave clears it",()=>{
 const sessions=[
  {id:"member_tab-a",data:{uid:"member",online:true,lastSeen:new Date(now-1000)}},
  {id:"member_tab-b",data:{uid:"member",online:true,lastSeen:new Date(now)}},
  {id:"member_expired",data:{uid:"member",online:true,lastSeen:new Date(now-75001)}}
 ];
 assert.deepEqual(replacementPresenceSession("member","tab-b",sessions,now),{sessionId:"tab-a",lastSeen:sessions[0].data.lastSeen});
 assert.equal(replacementPresenceSession("member","tab-a",[sessions[0]],now),null);
});

test("the authenticated server heartbeat refreshes the lease and member pointer",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addSession("owner","tab",now-80000);
 const result=await reconcileRoomLeadership(db,roomId,{now,heartbeatSession:{uid:"owner",expectedUid:"owner",sessionId:"tab"}});
 assert.equal(result.adminId,"owner");
 assert.equal(db.records.get(`rooms/${roomId}/presenceSessions/owner_tab`).lastSeen.getTime(),now);
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).lastSeen.getTime(),now);
});

test("server leave removes only the caller's session and immediately succeeds the next member",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addMember("next",2);
 addSession("owner","tab");addSession("next","tab");
 const result=await reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"owner",expectedUid:"owner",sessionId:"tab"}});
 assert.equal(db.records.has(`rooms/${roomId}/presenceSessions/owner_tab`),false);
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).online,false);
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).sessionId,null);
 assert.equal(result.adminId,"next");
 assert.equal(db.records.get(`rooms/${roomId}`).adminId,"next");
});

test("succession accepts a fresh lease while repairing the successor's stale member timestamp",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addMember("next",2);
 addSession("owner","leaving");addSession("next","active");
 db.records.get(`rooms/${roomId}/members/next`).lastSeen=new Date(now-75001);
 const result=await reconcileRoomLeadership(db,roomId,{
  now,leaveSession:{uid:"owner",expectedUid:"owner",sessionId:"leaving"}
 });
 assert.equal(result.adminId,"next");
 assert.equal(db.records.get(`rooms/${roomId}/members/next`).sessionId,"active");
 assert.equal(db.records.get(`rooms/${roomId}/members/next`).lastSeen.getTime(),now);
});

test("server leave preserves another tab for the same account",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addSession("owner","closing");addSession("owner","active",now-500);
 const result=await reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"owner",expectedUid:"owner",sessionId:"closing"}});
 assert.equal(db.records.has(`rooms/${roomId}/presenceSessions/owner_closing`),false);
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).online,true);
 assert.equal(db.records.get(`rooms/${roomId}/members/owner`).sessionId,"active");
 assert.equal(result.adminId,"owner");
});

test("presence operations cannot modify another account's session",async()=>{
 const {db,roomId,addMember,addSession}=setup();
 addMember("owner",1);addSession("owner","tab");
 await assert.rejects(()=>reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"owner",expectedUid:"attacker",sessionId:"tab"}}),/owning account/);
 assert.equal(db.records.has(`rooms/${roomId}/presenceSessions/owner_tab`),true);
});

test("normal leave and pagehide both use the shared transactional lease cleanup",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","lib/firestoreRooms.js"),"utf8");
 assert.match(source,/const markOffline=async\(\)=>\{[\s\S]*?syncServerPresence\("leave"\)/);
 assert.match(source,/const onPageHide=\(\)=>\{void markOffline\(\)\}/);
 assert.match(source,/void markOffline\(\)/);
 assert.match(source,/replacementPresenceSession\(user\.uid,sessionId/);
 assert.match(source,/syncServerPresence\("heartbeat"\)/);
});

test("joining never deletes another tab lease using the unsynchronized client clock",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","lib/firestoreRooms.js"),"utf8");
 assert.doesNotMatch(source,/oldSessions|deleteDoc\(item\.ref\)/);
 assert.match(source,/syncServerPresence=async operation=>/);
});

test("permission-denied roster listeners resynchronize presence and reconnect without changing rules",()=>{
 const source=fs.readFileSync(path.join(__dirname,"..","lib/firestoreRooms.js"),"utf8");
 const sessions=fs.readFileSync(path.join(__dirname,"..","lib/presenceSessions.cjs"),"utf8");
 const rules=fs.readFileSync(path.join(__dirname,"..","firestore.rules"),"utf8");
 assert.match(source,/error\?\.code==="permission-denied"&&\["members","presence","messages"\]\.includes\(source\)/);
 assert.match(source,/await syncServerPresence\("heartbeat"\);[\s\S]*?detachActiveDataListeners\(\);[\s\S]*?subscribeActiveDataListeners\(\)/);
 assert.match(source,/needsRoomMemberReconciliation\(member,presenceSessions,now\)/);
 assert.match(source,/if\(closed\|\|presenceRepairInProgress\|\|!roomMembers\.some\(member=>needsRoomMemberReconciliation/);
 assert.match(sessions,/function needsRoomMemberReconciliation\(/);
 assert.match(rules,/function isActiveMember\(roomId\)/);
 assert.match(rules,/allow list: if isActiveMember\(roomId\)/);
});

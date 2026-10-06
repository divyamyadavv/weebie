const test=require("node:test");
const assert=require("node:assert/strict");
const {reconcileRoomLeadership}=require("../functions/roomLeadership.cjs");

const now=1_700_000_000_000;
const MINUTE=60_000;

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
 has(path){return this.records.has(path)}
 get(path){return this.records.get(path)}
}

function setup(){
 const db=new MemoryFirestore(),roomId="HARD01";
 db.set(`rooms/${roomId}`,{ownerUid:"owner",originalOwnerId:"owner",hostId:"owner",adminId:"owner",voluntaryTransfer:false,leadershipRevision:0});
 const addMember=(uid,{joinSequence,joinedAt,sessionLastSeen=now}={})=>{
  db.set(`rooms/${roomId}/members/${uid}`,{uid,joinSequence,joinedAt:joinedAt===undefined?undefined:new Date(joinedAt),online:true,sessionId:uid,lastSeen:new Date(sessionLastSeen),kicked:false});
  db.set(`rooms/${roomId}/presenceSessions/${uid}_${uid}`,{uid,online:true,lastSeen:new Date(sessionLastSeen)});
 };
 return {db,roomId,addMember,room:()=>db.get(`rooms/${roomId}`)};
}

test("presence sessions that expired long ago are deleted instead of accumulating forever",async()=>{
 const {db,roomId,addMember}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-10*MINUTE});
 addMember("guest",{joinSequence:2,joinedAt:now-9*MINUTE});
 // Abruptly closed tabs: never sent "leave", so only expired docs remain.
 for(let index=0;index<5;index++)db.set(`rooms/${roomId}/presenceSessions/guest_dead${index}`,{uid:"guest",online:true,lastSeen:new Date(now-30*MINUTE)});
 db.set(`rooms/${roomId}/presenceSessions/guest_off`,{uid:"guest",online:false,lastSeen:new Date(now-20*MINUTE)});
 await reconcileRoomLeadership(db,roomId,{now});
 for(let index=0;index<5;index++)assert.equal(db.has(`rooms/${roomId}/presenceSessions/guest_dead${index}`),false);
 assert.equal(db.has(`rooms/${roomId}/presenceSessions/guest_off`),false);
 assert.equal(db.has(`rooms/${roomId}/presenceSessions/owner_owner`),true,"live session must survive");
 assert.equal(db.has(`rooms/${roomId}/presenceSessions/guest_guest`),true,"live session must survive");
});

test("a recently expired session is kept (marked offline) so a briefly sleeping tab can resume",async()=>{
 const {db,roomId,addMember}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-10*MINUTE});
 db.set(`rooms/${roomId}/presenceSessions/owner_sleeper`,{uid:"owner",online:true,lastSeen:new Date(now-3*MINUTE)});
 await reconcileRoomLeadership(db,roomId,{now});
 assert.equal(db.get(`rooms/${roomId}/presenceSessions/owner_sleeper`)?.online,false);
});

test("pruning never removes a session that just heartbeated, even if it had been dormant",async()=>{
 const {db,roomId,addMember}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-60*MINUTE,sessionLastSeen:now-40*MINUTE});
 const result=await reconcileRoomLeadership(db,roomId,{now,heartbeatSession:{uid:"owner",expectedUid:"owner",sessionId:"owner"}});
 assert.equal(db.has(`rooms/${roomId}/presenceSessions/owner_owner`),true);
 assert.equal(db.get(`rooms/${roomId}/presenceSessions/owner_owner`).online,true);
 assert.equal(result.adminId,"owner");
});

test("succession follows server-trusted joinedAt even if a client wrote a smaller joinSequence",async()=>{
 const {db,roomId,addMember,room}=setup();
 db.set(`rooms/${roomId}`,{...room(),adminId:"owner"});
 addMember("honest",{joinSequence:1_700_000_000_500,joinedAt:now-5*MINUTE});
 addMember("cheater",{joinSequence:2,joinedAt:now-1*MINUTE}); // forged tiny sequence, joined later
 // Owner is simply absent (no session) -> succession decides.
 db.records.delete(`rooms/${roomId}/presenceSessions/owner_owner`);
 await reconcileRoomLeadership(db,roomId,{now});
 assert.equal(room().adminId,"honest");
});

test("members without joinedAt still fall back to joinSequence ordering",async()=>{
 const {db,roomId,addMember,room}=setup();
 addMember("late",{joinSequence:30});
 addMember("early",{joinSequence:10});
 await reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"owner",expectedUid:"owner",sessionId:"owner"}});
 assert.equal(room().adminId,"early");
});

test("admin and the next-in-line leaving at the same moment hand admin to the remaining member exactly once",async()=>{
 const {db,roomId,addMember,room}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-10*MINUTE});
 addMember("second",{joinSequence:2,joinedAt:now-9*MINUTE});
 addMember("third",{joinSequence:3,joinedAt:now-8*MINUTE});
 const results=await Promise.all([
  reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"owner",expectedUid:"owner",sessionId:"owner"}}),
  reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"second",expectedUid:"second",sessionId:"second"}})
 ]);
 assert.equal(room().adminId,"third");
 assert.deepEqual(results.map(result=>result.adminId).filter(Boolean).every(id=>["second","third"].includes(id)),true);
 assert.equal(db.get(`rooms/${roomId}/members/owner`).online,false);
 assert.equal(db.get(`rooms/${roomId}/members/second`).online,false);
 assert.equal(db.get(`rooms/${roomId}/members/third`).online,true);
});

test("two non-admin members leaving together leave the admin untouched",async()=>{
 const {db,roomId,addMember,room}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-10*MINUTE});
 addMember("a",{joinSequence:2,joinedAt:now-9*MINUTE});
 addMember("b",{joinSequence:3,joinedAt:now-8*MINUTE});
 await Promise.all([
  reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"a",expectedUid:"a",sessionId:"a"}}),
  reconcileRoomLeadership(db,roomId,{now,leaveSession:{uid:"b",expectedUid:"b",sessionId:"b"}})
 ]);
 assert.equal(room().adminId,"owner");
 assert.equal(db.get(`rooms/${roomId}/members/owner`).online,true);
});

test("abrupt admin disconnect: remaining member's heartbeat after lease expiry promotes exactly one successor",async()=>{
 const {db,roomId,addMember,room}=setup();
 addMember("owner",{joinSequence:1,joinedAt:now-10*MINUTE,sessionLastSeen:now-100_000}); // lease long expired, no leave sent
 addMember("second",{joinSequence:2,joinedAt:now-9*MINUTE,sessionLastSeen:now-5_000});
 addMember("third",{joinSequence:3,joinedAt:now-8*MINUTE,sessionLastSeen:now-5_000});
 const result=await reconcileRoomLeadership(db,roomId,{now,heartbeatSession:{uid:"third",expectedUid:"third",sessionId:"third"}});
 assert.equal(result.adminId,"second");
 assert.equal(room().adminId,"second");
 assert.equal(db.get(`rooms/${roomId}/members/owner`).online,false);
});

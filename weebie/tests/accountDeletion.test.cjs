const test=require("node:test");
const assert=require("node:assert/strict");
const {deleteAccountData,isRecentSignIn,REAUTH_WINDOW_SECONDS}=require("../lib/accountDeletion.cjs");

class FakeDb{
 constructor(){this.docs=new Map();this.events=[]}
 set(path,data={}){this.docs.set(path,data);return this}
 has(path){return this.docs.has(path)}
 doc(path){return {path,id:path.split("/").at(-1)}}
 children(collectionPath){
  return [...this.docs.entries()].filter(([path])=>path.startsWith(`${collectionPath}/`)&&!path.slice(collectionPath.length+1).includes("/"))
   .map(([path,value])=>({id:path.split("/").at(-1),ref:this.doc(path),data:()=>value}));
 }
 collection(path){
  const all=()=>this.children(path);
  return {
   get:async()=>{const docs=all();return {docs,size:docs.length}},
   where:(field,operator,value)=>({get:async()=>{
    const docs=all().filter(item=>{const actual=item.data()[field];return operator==="=="?actual===value:operator==="array-contains"?Array.isArray(actual)&&actual.includes(value):false});
    return {docs,size:docs.length};
   }})
  };
 }
 batch(){const refs=[];return {delete:ref=>refs.push(ref),commit:async()=>{for(const ref of refs){this.docs.delete(ref.path);this.events.push(`delete:${ref.path}`)}}}}
 async recursiveDelete(ref){
  for(const path of [...this.docs.keys()])if(path===ref.path||path.startsWith(`${ref.path}/`))this.docs.delete(path);
  this.events.push(`recursive:${ref.path}`);
 }
}

function seed(){
 const db=new FakeDb();
 db.set("users/alice/rooms/ROOM1",{code:"ROOM1"});
 db.set("rooms/ROOM1/members/alice",{uid:"alice"}).set("rooms/ROOM1/members/bob",{uid:"bob"});
 db.set("rooms/ROOM1/presenceSessions/alice_s1",{uid:"alice"}).set("rooms/ROOM1/presenceSessions/bob_s1",{uid:"bob"});
 db.set("users/alice/friends/bob").set("users/bob/friends/alice").set("users/bob/friends/carol").set("users/carol/friends/bob");
 db.set("users/alice/blocks/carol",{blockedUid:"carol"}).set("users/alice/presenceSessions/tab1",{uid:"alice"});
 db.set("friendRequests/r1",{senderUid:"alice",recipientUid:"carol"}).set("friendRequests/r2",{senderUid:"carol",recipientUid:"bob"});
 db.set("roomInvitations/i1",{senderUid:"bob",recipientUid:"alice"}).set("roomInvitations/i2",{senderUid:"bob",recipientUid:"carol"});
 db.set("conversations/c1",{participants:["alice","bob"]}).set("conversations/c1/messages/m1",{text:"hi"}).set("conversations/c2",{participants:["bob","carol"]});
 db.set("driveAuthorizations/alice",{token:"x"}).set("driveAuthorizations/bob",{token:"y"});
 return db;
}
function services(db,overrides={}){
 const calls=[];
 return {
  calls,
  auth:{deleteUser:async uid=>{db.events.push(`auth-delete:${uid}`);calls.push(uid);if(overrides.authFails)throw new Error("auth failed")}},
  removeDriveGrant:async uid=>{if(overrides.driveFails)throw new Error("drive failed");db.docs.delete(`driveAuthorizations/${uid}`);db.events.push(`drive:${uid}`)},
  reconcileRoom:async roomId=>{db.events.push(`reconcile:${roomId}`)}
 };
}

test("deletes only the target account's data and leaves other people's data intact",async()=>{
 const db=seed(),s=services(db);
 const result=await deleteAccountData({db,uid:"alice",...s});
 assert.deepEqual(result,{deleted:true,rooms:1,friends:1});
 for(const path of ["users/alice/rooms/ROOM1","users/alice/friends/bob","users/alice/blocks/carol","users/alice/presenceSessions/tab1","rooms/ROOM1/members/alice","rooms/ROOM1/presenceSessions/alice_s1","users/bob/friends/alice","friendRequests/r1","roomInvitations/i1","conversations/c1","conversations/c1/messages/m1","driveAuthorizations/alice"])assert.equal(db.has(path),false,path);
 for(const path of ["rooms/ROOM1/members/bob","rooms/ROOM1/presenceSessions/bob_s1","users/bob/friends/carol","users/carol/friends/bob","friendRequests/r2","roomInvitations/i2","conversations/c2","driveAuthorizations/bob"])assert.equal(db.has(path),true,path);
});

test("the room's leadership is reconciled after the account leaves it",async()=>{
 const db=seed(),s=services(db);
 await deleteAccountData({db,uid:"alice",...s});
 const leave=db.events.findIndex(event=>event==="delete:rooms/ROOM1/members/alice");
 const reconcile=db.events.indexOf("reconcile:ROOM1");
 assert.ok(leave>=0&&reconcile>leave,"reconcile must run after the member record is removed");
});

test("the sign-in account is deleted last, after every data removal",async()=>{
 const db=seed(),s=services(db);
 await deleteAccountData({db,uid:"alice",...s});
 assert.deepEqual(s.calls,["alice"]);
 assert.equal(db.events.at(-1),"auth-delete:alice");
 assert.ok(db.events.indexOf("recursive:users/alice")<db.events.indexOf("auth-delete:alice"));
});

test("a failure part-way never deletes the sign-in account, so the user can retry",async()=>{
 const db=seed(),s=services(db,{driveFails:true});
 await assert.rejects(()=>deleteAccountData({db,uid:"alice",...s}),/drive failed/);
 assert.deepEqual(s.calls,[]);
 assert.equal(db.has("driveAuthorizations/alice"),true);
});

test("a failing room reconcile is logged but does not abort the deletion",async()=>{
 const db=seed(),s=services(db),logs=[];
 s.reconcileRoom=async()=>{throw Object.assign(new Error("quota"),{code:8})};
 const result=await deleteAccountData({db,uid:"alice",...s,log:(...args)=>logs.push(args)});
 assert.equal(result.deleted,true);
 assert.equal(logs.length,1);
 assert.deepEqual(s.calls,["alice"]);
});

test("an invalid uid is refused before anything is touched",async()=>{
 const db=seed(),s=services(db);
 for(const uid of ["","a/b",null,undefined,42])await assert.rejects(()=>deleteAccountData({db,uid,...s}),/valid account/);
 assert.equal(db.events.length,0);
});

test("only a recent sign-in may delete an account",()=>{
 const now=1_700_000_000;
 assert.equal(isRecentSignIn({auth_time:now-10},now),true);
 assert.equal(isRecentSignIn({auth_time:now-REAUTH_WINDOW_SECONDS},now),true);
 assert.equal(isRecentSignIn({auth_time:now-REAUTH_WINDOW_SECONDS-1},now),false);
 assert.equal(isRecentSignIn({auth_time:now-86400},now),false);
 assert.equal(isRecentSignIn({auth_time:now+3600},now),false,"a future auth_time is not trusted");
 assert.equal(isRecentSignIn({},now),false);
 assert.equal(isRecentSignIn(null,now),false);
});

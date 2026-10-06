const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {KICKED_ROOM_MESSAGE,roomEntryDecision,getRoomEntryDecision}=require("../lib/roomAccess.cjs");

test("kicked Join preflight uses the established room rejoin notice",()=>{
 assert.equal(KICKED_ROOM_MESSAGE,"You were removed from this room and cannot rejoin this invite.");
});

test("room entry preflight rejects a kicked member but keeps their historical room card decision read-only",async()=>{
 const records=new Map([
  ["rooms/ABC123",{exists:true,data:()=>({name:"Room"})}],
  ["rooms/ABC123/members/kicked-user",{exists:true,data:()=>({uid:"kicked-user",kicked:true})}]
 ]);
 const reads=[];
 const db={doc:documentPath=>({get:async()=>{reads.push(documentPath);return records.get(documentPath)||{exists:false,data:()=>undefined}}})};
 const result=await getRoomEntryDecision(db,"ABC123","kicked-user");
 assert.deepEqual(result,{allowed:false,code:"ROOM_KICKED",message:KICKED_ROOM_MESSAGE});
 assert.deepEqual(reads,["rooms/ABC123","rooms/ABC123/members/kicked-user"]);
 assert.equal(records.get("rooms/ABC123/members/kicked-user").data().kicked,true);
});

test("fresh admin re-invitation permits only the re-invited UID; voluntary leavers remain eligible",()=>{
 assert.equal(roomEntryDecision({roomExists:true,memberExists:true,member:{uid:"invited-again",kicked:false,online:false}}).allowed,true);
 assert.equal(roomEntryDecision({roomExists:true,memberExists:true,member:{uid:"other-kicked",kicked:true}}).code,"ROOM_KICKED");
 assert.equal(roomEntryDecision({roomExists:true,memberExists:true,member:{uid:"voluntary-leaver",kicked:false,online:false}}).allowed,true);
 assert.equal(roomEntryDecision({roomExists:true,memberExists:false,member:null}).allowed,true);
});

test("preflight distinguishes unavailable rooms and blocked members",()=>{
 assert.equal(roomEntryDecision({roomExists:false,memberExists:false}).code,"ROOM_NOT_FOUND");
 assert.equal(roomEntryDecision({roomExists:true,memberExists:true,member:{blocked:true}}).code,"ROOM_BLOCKED");
 assert.equal(roomEntryDecision({roomExists:true,memberExists:true,member:{kicked:false}}).allowed,true);
});

test("room access API and client gates room subscriptions and routes kicks back to My Rooms",()=>{
 const root=path.join(__dirname,"..");
 const route=fs.readFileSync(path.join(root,"app/api/rooms/[code]/access/route.js"),"utf8");
 const rooms=fs.readFileSync(path.join(root,"app/rooms/page.js"),"utf8");
 const room=fs.readFileSync(path.join(root,"app/room/[code]/page.js"),"utf8");
 assert.match(route,/assertSameOrigin\(request\)/);
 assert.match(route,/verifyFirebaseIdToken\(request\)/);
 assert.match(route,/getRoomEntryDecision/);
 assert.match(rooms,/\/api\/rooms\/\$\{encodeURIComponent\(room\.code\)\}\/access/);
 assert.match(rooms,/result\.code==="ROOM_KICKED"/);
 assert.match(rooms,/window\.location\.assign\(`\/room\/\$\{room\.code\}`\)/);
 assert.match(room,/R=useRoom\(code,roomUser/);
 assert.match(room,/roomAccess\.status==="allowed"\?me:""/);
 assert.match(room,/result\.code==="ROOM_KICKED"/);
 assert.match(room,/router\.replace\("\/rooms"\)/);
 assert.match(room,/if\(R\.moderation\.kicked\)router\.replace\("\/dashboard"\)/);
 const connection=fs.readFileSync(path.join(root,"lib/firestoreRooms.js"),"utf8");
 assert.match(connection,/if\(oldMember\.kicked\)throw new Error/);
 assert.match(connection,/transaction\.set\(memberRef/);
 assert.doesNotMatch(connection,/transaction\.get\(targetSessionsQuery\)/);
 assert.match(connection,/F\.doc\(roomRef,"presenceSessions",`\$\{targetId\}_\$\{targetSessionId\}`\)/);
});

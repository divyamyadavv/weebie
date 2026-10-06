const test=require("node:test");
const assert=require("node:assert/strict");
const {authorizeRoomVideo}=require("../lib/roomVideoAccess.cjs");

const room={hostId:"host",originalOwnerId:"host",source:{type:"drive",fileId:"drive-file",driveOwnerUid:"host",size:1234}};
const activeMember={uid:"member",online:true,kicked:false};

test("allows an active room member with a live presence lease to stream only the room-selected host file",()=>{
 assert.deepEqual(authorizeRoomVideo({uid:"member",room,member:activeMember,activeSession:true}),{ok:true,ownerUid:"host",fileId:"drive-file",size:1234});
});

test("denies missing identity, non-members, and removed members",()=>{
 assert.equal(authorizeRoomVideo({uid:null,room,member:activeMember}).status,401);
 assert.equal(authorizeRoomVideo({uid:"stranger",room,member:null}).status,403);
 assert.equal(authorizeRoomVideo({uid:"member",room,member:{...activeMember,kicked:true}}).status,403);
 assert.equal(authorizeRoomVideo({uid:"member",room,member:activeMember}).status,403);
 assert.equal(authorizeRoomVideo({uid:"member",room,member:{...activeMember,online:false},activeSession:true}).status,403);
});

test("denies a room without a Drive source or with a mismatched Drive owner",()=>{
 assert.equal(authorizeRoomVideo({uid:"member",room:{...room,source:null},member:activeMember,activeSession:true}).status,404);
 const changed={...room,source:{...room.source,driveOwnerUid:"attacker"}};
 assert.equal(authorizeRoomVideo({uid:"member",room:changed,member:activeMember,activeSession:true}).status,403);
});
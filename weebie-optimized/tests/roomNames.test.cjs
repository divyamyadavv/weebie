const test=require("node:test");
const assert=require("node:assert/strict");
const {makeDriveRoomName}=require("../lib/roomNames.cjs");

test("keeps generated Drive room names within the Firestore rule limit",()=>{
 const name=makeDriveRoomName("A".repeat(200));
 assert.equal(name.length,80);
 assert.equal(name,"A".repeat(68)+" watch party");
});

test("uses a stable fallback for unnamed Drive files",()=>{
 assert.equal(makeDriveRoomName(""),"Drive video watch party");
});
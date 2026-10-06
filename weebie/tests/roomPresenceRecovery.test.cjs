const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {classifyPresenceFailure,resolveRoomAdminId}=require("../lib/roomPresenceRecovery.cjs");

test("a lost presence session (409) triggers a rejoin instead of leaving a ghost tab",()=>{
 assert.equal(classifyPresenceFailure(Object.assign(new Error("gone"),{status:409})),"rejoin");
});

test("kicked/forbidden (403) and missing room (404) are terminal and never retried",()=>{
 assert.equal(classifyPresenceFailure(Object.assign(new Error("no"),{status:403})),"terminal");
 assert.equal(classifyPresenceFailure(Object.assign(new Error("no"),{status:404})),"terminal");
});

test("network and server errors keep the normal retry behaviour",()=>{
 assert.equal(classifyPresenceFailure(new Error("Failed to fetch")),"retry");
 assert.equal(classifyPresenceFailure(Object.assign(new Error("boom"),{status:500})),"retry");
 assert.equal(classifyPresenceFailure(null),"retry");
});

test("an explicitly null adminId means no admin; it never falls back to the original host",()=>{
 assert.equal(resolveRoomAdminId({adminId:null,hostId:"host"}),null);
 assert.equal(resolveRoomAdminId({adminId:"member",hostId:"host"}),"member");
});

test("legacy rooms without an adminId field still resolve to their host",()=>{
 assert.equal(resolveRoomAdminId({hostId:"host"}),"host");
 assert.equal(resolveRoomAdminId(null),null);
});

const source=fs.readFileSync(path.join(__dirname,"../lib/firestoreRooms.js"),"utf8");

test("heartbeat failures route through presence recovery (rejoin) rather than only showing an error",()=>{
 assert.match(source,/classifyPresenceFailure/);
 assert.match(source,/const refreshPresence=\(\)=>syncServerPresence\("heartbeat"\)\.catch\(recoverPresence\)/);
 assert.match(source,/applyMemberPresence[\s\S]*?syncServerPresence\("heartbeat"\)\.catch\(recoverPresence\)/);
});

test("the room listener resolves admin through resolveRoomAdminId, not a hostId fallback",()=>{
 assert.match(source,/adminId=resolveRoomAdminId\(data\)/);
 assert.doesNotMatch(source,/adminId=data\.adminId\|\|data\.hostId/);
});

test("visibility, network and bfcache restores refresh presence, and every listener is removed on off()",()=>{
 for(const event of ["visibilitychange","online","pageshow","pagehide"]){
  assert.match(source,new RegExp(`addEventListener\\("${event}"`));
  assert.match(source,new RegExp(`removeEventListener\\("${event}"`));
 }
});

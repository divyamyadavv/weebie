const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

test("admin transfer is awaited, reports errors, and checks eligibility with trusted server time",()=>{
 const page=fs.readFileSync(path.join(__dirname,"..","app","room","[code]","page.js"),"utf8");
 const rooms=fs.readFileSync(path.join(__dirname,"..","lib","firestoreRooms.js"),"utf8");
 const transfer=rooms.slice(rooms.indexOf("transfer:async targetId=>"));
 assert.match(page,/const transfer=async memberId=>\{[\s\S]*?await R\.transferAdmin\(memberId\)[\s\S]*?catch\(exception\)\{setErr\(exception\?\.message\|\|"Admin transfer failed\."\)\}/);
 assert.match(transfer,/await syncServerPresence\("heartbeat"\)/);
 assert.match(transfer,/presence\.adminId!==user\.uid/);
 assert.match(transfer,/const trustedNow=Date\.now\(\)\+serverClockOffset;/);
 assert.match(transfer,/activeRoomMemberUids\(roomMembers,presenceSessions,trustedNow\)/);
 assert.match(transfer,/activeRoomMemberUids\(\s*\[\{id:targetId,data:targetSnapshot\.data\(\)\}\],\s*targetSession\?\.exists\(\)\?\[\{[\s\S]*?targetSessionRef\.id\}\]:\[\],\s*trustedNow\s*\)\.has\(targetId\)/);
 assert.match(transfer,/console\.error\(`\[room:\$\{code\}\] admin transfer failed`,error\?\.code\|\|"unknown",error\?\.message\|\|""\)/);
});

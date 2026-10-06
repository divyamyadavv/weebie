const test=require("node:test");
const assert=require("node:assert/strict");
const {PRESENCE_STALE_AFTER_MS,activeRoomMemberRecords,needsRoomMemberReconciliation,roomMemberSnapshotRecord}=require("../lib/presenceSessions.cjs");
const {activeRoomMembers,summarizeActiveRoom,classifyRoomForUser}=require("../lib/activeRooms.cjs");
const {assertSameOrigin,OriginValidationError}=require("../lib/requestOrigin.cjs");

const now=1_700_000_000_000;
const firestoreTimestamp=milliseconds=>({toMillis:()=>milliseconds});
const member=(uid,extra={})=>({id:uid,data:{uid,name:uid,photoURL:`https://images.test/${uid}.png`,joinSequence:1,kicked:false,online:true,sessionId:Object.prototype.hasOwnProperty.call(extra,"sessionId")?extra.sessionId:`${uid}-tab`,lastSeen:new Date(now),...extra}});
const session=(uid,id,age=0,extra={})=>({uid,online:true,lastSeen:now-age,id,documentId:`${uid}_${id}`,...extra});

test("a room with zero active members is hidden",()=>{
 assert.equal(summarizeActiveRoom("ABC123",{name:"Watch"},[member("a")],[],now),null);
});

test("one valid active session shows its member and profile image",()=>{
 const result=summarizeActiveRoom("ABC123",{name:"Watch"},[member("a")],[session("a","a-tab")],now);
 assert.deepEqual(result,{code:"ABC123",name:"Watch",members:1,activeMembers:[{name:"a",photoURL:"https://images.test/a.png"}],createdAt:0});
});

test("multiple active members appear with their profiles and the My Rooms count matches the live roster",()=>{
 const members=[
  member("a",{name:"Alice",photoURL:"https://images.test/alice.png",joinSequence:1,sessionId:"alice-tab"}),
  member("b",{name:"Bob",photoURL:"https://images.test/bob.png",joinSequence:2,sessionId:"bob-tab"})
 ];
 const sessions=[session("a","alice-tab"),session("b","bob-tab")];
 const roster=activeRoomMemberRecords(members,sessions,now);
 const room=summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now);
 assert.equal(room.members,2);
 assert.equal(roster.length,room.members);
 assert.deepEqual(roster.map(({id,name,photoURL})=>({id,name,photoURL})),[
  {id:"a",name:"Alice",photoURL:"https://images.test/alice.png"},
  {id:"b",name:"Bob",photoURL:"https://images.test/bob.png"}
 ]);
});

test("the My Rooms count and in-room roster agree for the same presence snapshot",()=>{
 const roomMembers=[
  member("a",{name:"Alice",photoURL:"https://images.test/alice.png",sessionId:"tab-b"}),
  member("b",{name:"Bob",sessionId:"stale-tab"}),
  member("c",{name:"Carol",sessionId:"missing-tab"})
 ];
 const sessions=[
  session("a","tab-a"),
  session("a","tab-b"),
  session("b","stale-tab",PRESENCE_STALE_AFTER_MS+1),
  session("orphan","orphan-tab")
 ];
 const card=summarizeActiveRoom("ABC123",{name:"Watch"},roomMembers,sessions,now);
 const roster=activeRoomMemberRecords(roomMembers,sessions,now);
 assert.equal(card.members,1);
 assert.equal(roster.length,1);
 assert.deepEqual(card.activeMembers,[{name:"Alice",photoURL:"https://images.test/alice.png"}]);
 assert.deepEqual(roster.map(({id,name,photoURL,online})=>({id,name,photoURL,online})),[
  {id:"a",name:"Alice",photoURL:"https://images.test/alice.png",online:true}
 ]);
});

test("Firestore roster snapshot retains presence fields needed to match the My Rooms count",()=>{
 const storedMember={
  uid:"a",name:"Alice",photoURL:"https://images.test/alice.png",online:true,
  sessionId:"tab-a",lastSeen:new Date(now),joinSequence:1,kicked:false
 };
 const storedSession={uid:"a",online:true,lastSeen:new Date(now),documentId:"a_tab-a"};
 const rosterSnapshot=[roomMemberSnapshotRecord("a",storedMember,"a","a")];
 const card=summarizeActiveRoom("ABC123",{name:"Watch"},[{id:"a",data:storedMember}],[storedSession],now,"a");
 const roster=activeRoomMemberRecords(rosterSnapshot,[storedSession],now);
 assert.equal(card.members,1);
 assert.equal(roster.length,1);
 assert.equal(roster[0].online,true);
 assert.equal(roster[0].name,card.activeMembers[0].name);
 assert.equal(roster[0].photoURL,card.activeMembers[0].photoURL);
 assert.equal(roster[0].self,true);
 assert.equal(roster[0].admin,true);
});

test("server-synchronized presence time prevents clock skew from hiding a valid roster member",()=>{
 const roomMembers=[member("a",{name:"Alice",sessionId:"tab"})];
 const sessions=[session("a","tab")];
 const clientNow=now-120000;
 const card=summarizeActiveRoom("ABC123",{name:"Watch"},roomMembers,sessions,now);
 assert.equal(activeRoomMemberRecords(roomMembers,sessions,clientNow).length,0);
 assert.equal(card.members,1);
 assert.equal(activeRoomMemberRecords(roomMembers,sessions,now).length,card.members);
});

test("normal leave removes the member from both active-room count and room roster",()=>{
 const members=[member("a",{sessionId:"tab"})],sessions=[session("a","tab",0,{online:false})];
 assert.equal(summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now),null);
 assert.deepEqual(activeRoomMemberRecords(members,sessions,now),[]);
});

test("a kicked member leaves the live roster while historical join messages remain untouched",()=>{
 const members=[
  member("a",{name:"Alice",sessionId:"alice-tab",joinSequence:1}),
  member("b",{name:"Bob",sessionId:"bob-tab",joinSequence:2,kicked:true,online:false})
 ];
 const sessions=[session("a","alice-tab"),session("b","bob-tab")];
 const history=[{system:true,systemType:"join",u:"Alice",t:now-1000},{system:true,systemType:"join",u:"Bob",t:now-500}];
 const roster=activeRoomMemberRecords(members,sessions,now);
 const room=summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now);
 assert.deepEqual(roster.map(({id})=>id),["a"]);
 assert.equal(room.members,roster.length);
 assert.equal(history.length,2);
});

test("the last member leaving removes the room from the summary",()=>{
 const members=[member("a")];
 assert.equal(summarizeActiveRoom("ABC123",{name:"Watch"},members,[session("a","tab",0,{online:false})],now),null);
});

test("a current active session with a stale member pointer requests server reconciliation",()=>{
 const storedMember=member("a",{name:"Alice",sessionId:"closed-tab",lastSeen:new Date(now),online:true});
 const liveSession=session("a","open-tab");
 assert.equal(needsRoomMemberReconciliation(storedMember,[liveSession],now),true);
 assert.equal(needsRoomMemberReconciliation(member("a",{sessionId:"open-tab"}),[liveSession],now),false);
 assert.equal(needsRoomMemberReconciliation(member("a",{sessionId:"closed-tab",kicked:true}),[liveSession],now),false);
 assert.equal(needsRoomMemberReconciliation(member("a",{sessionId:"closed-tab"}),[session("a","open-tab",PRESENCE_STALE_AFTER_MS+1)],now),false);
});

test("expired sessions do not keep a room visible",()=>{
 const result=activeRoomMembers([member("a")],[session("a","old",PRESENCE_STALE_AFTER_MS+1)],now);
 assert.deepEqual(result,[]);
});

test("multiple tabs for one uid count once",()=>{
 const result=activeRoomMembers([member("a",{sessionId:"two"})],[session("a","one"),session("a","two")],now);
 assert.equal(result.length,1);
});

test("leaving one tab keeps the user active while another lease remains",()=>{
 const result=activeRoomMembers([member("a",{sessionId:"open"})],[session("a","closed",0,{online:false}),session("a","open")],now);
 assert.equal(result.length,1);
});

test("orphaned or unpointed fresh leases do not create active members",()=>{
 assert.deepEqual(activeRoomMembers([member("a",{sessionId:"another-tab"})],[session("a","orphaned")],now),[]);
 assert.deepEqual(activeRoomMembers([member("a",{sessionId:null})],[session("a","a-tab")],now),[]);
});

test("a fresh matching lease remains authoritative while the member lastSeen awaits repair",()=>{
 const members=[{id:"a",data:{
  uid:"a",name:"Alice",photoURL:"https://images.test/a.png",online:true,sessionId:"a-tab",
  lastSeen:firestoreTimestamp(now-PRESENCE_STALE_AFTER_MS-1),joinSequence:1,kicked:false
 }}];
 const sessions=[{uid:"a",online:true,lastSeen:firestoreTimestamp(now),documentId:"a_a-tab"}];
 const roster=activeRoomMemberRecords(members,sessions,now);
 const room=summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now);
 assert.equal(roster.length,1);
 assert.equal(room.members,roster.length);
 assert.equal(needsRoomMemberReconciliation(members[0],sessions,now),true);
});

test("ineligible member documents are excluded from both the roster and My Rooms count",()=>{
 const members=[member("a",{eligible:false})],sessions=[session("a","a-tab")];
 assert.deepEqual(activeRoomMemberRecords(members,sessions,now),[]);
 assert.equal(summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now),null);
});

test("only the last live tab leaving removes the member",()=>{
 const sessions=[session("a","first",0,{online:false}),session("a","second",0,{online:false})];
 assert.deepEqual(activeRoomMembers([member("a")],sessions,now),[]);
});

test("room cards remain visible without exposing the live roster to a viewer without current presence",()=>{
 const members=[member("viewer",{sessionId:"live"}),member("other",{sessionId:"live"})],sessions=[session("viewer","live"),session("other","live")];
 assert.equal(summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now,"viewer").members,2);
 const card=summarizeActiveRoom("ABC123",{name:"Watch"},members,sessions,now,"viewer-without-lease");
 assert.equal(card.members,2);
 assert.deepEqual(card.activeMembers,[]);
});

test("historical and kicked members see an active card while live roster details stay private",()=>{
 const room={name:"Watch"},members=[member("viewer",{sessionId:null,online:false,kicked:true}),member("other",{sessionId:"active"})],sessions=[session("other","active")];
 const classified=classifyRoomForUser("ABC123",room,members,sessions,"viewer",now);
 assert.equal(classified.activeRoom.code,"ABC123");
 assert.equal(classified.activeRoom.members,1);
 assert.deepEqual(classified.activeRoom.activeMembers,[]);
 assert.equal(classified.pastRoom,null);
});

test("active member names and profile images reflect current member documents",()=>{
 const active=summarizeActiveRoom("ABC123",{name:"Watch"},[member("a",{name:"Updated name",photoURL:"https://images.test/new.png",sessionId:"tab"})],[session("a","tab")],now);
 assert.deepEqual(active.activeMembers,[{name:"Updated name",photoURL:"https://images.test/new.png"}]);
 assert.equal(active.members,1);
});

test("missing, kicked, blocked, and mismatched member records are excluded",()=>{
 const members=[member("kicked",{kicked:true}),member("blocked",{blocked:true}),member("mismatch",{uid:"another"})];
 const sessions=[session("missing","1"),session("kicked","2"),session("blocked","3"),session("mismatch","4")];
 assert.deepEqual(activeRoomMembers(members,sessions,now),[]);
});

test("a room reappears when a joined user's fresh session is present",()=>{
 const room={name:"Old invite room"};
 assert.equal(summarizeActiveRoom("ABC123",room,[member("invitee",{sessionId:null})],[],now,"invitee"),null);
 assert.equal(summarizeActiveRoom("ABC123",room,[member("invitee",{sessionId:"joined"})],[session("invitee","joined")],now,"invitee").members,1);
 assert.equal(classifyRoomForUser("ABC123",room,[member("invitee",{sessionId:"joined"})],[session("invitee","joined")],"invitee",now).activeRoom.members,1);
});

test("active and past room lists transition as live sessions arrive and expire",()=>{
 const room={name:"Old link room"},members=[member("history",{kicked:true}),member("joined",{sessionId:null})];
 const past=classifyRoomForUser("ABC123",room,members,[],"history",now);
 assert.equal(past.activeRoom,null);
 assert.equal(past.pastRoom.code,"ABC123");
 members[1]=member("joined",{sessionId:"fresh"});
 const joined=classifyRoomForUser("ABC123",room,members,[session("joined","fresh")],"history",now);
 assert.equal(joined.activeRoom.members,1);
 assert.deepEqual(joined.activeRoom.activeMembers,[]);
 assert.equal(joined.pastRoom,null);
 const expired=classifyRoomForUser("ABC123",room,members,[session("joined","fresh",PRESENCE_STALE_AFTER_MS+1)],"history",now);
 assert.equal(expired.activeRoom,null);
 assert.equal(expired.pastRoom.code,"ABC123");
});

test("voluntary session cleanup leaves the membership un-kicked",()=>{
 const room={name:"Voluntary leave"},members=[member("viewer",{sessionId:"tab"})];
 const before=classifyRoomForUser("ABC123",room,members,[session("viewer","tab")],"viewer",now);
 assert.equal(before.activeRoom.members,1);
 members[0].data.online=false;
 const after=classifyRoomForUser("ABC123",room,members,[session("viewer","tab",0,{online:false})],"viewer",now);
 assert.equal(after.activeRoom,null);
 assert.equal(after.pastRoom.code,"ABC123");
 assert.equal(members[0].data.kicked,false);
});

test("same-origin browser API requests pass origin checks while external origins are rejected",()=>{
 assert.doesNotThrow(()=>assertSameOrigin(new Request("http://localhost:3000/api/rooms/active",{
  method:"GET",headers:{"sec-fetch-site":"same-origin"}
 })));
 assert.doesNotThrow(()=>assertSameOrigin(new Request("http://internal:3000/api/rooms/active",{
  method:"GET",headers:{"sec-fetch-site":"same-origin","x-forwarded-host":"weebie.example","x-forwarded-proto":"https"}
 })));
 assert.doesNotThrow(()=>assertSameOrigin(new Request("https://weebie.example/api/rooms/active",{
  method:"POST",headers:{origin:"https://weebie.example"}
 })));
 assert.throws(()=>assertSameOrigin(new Request("https://weebie.example/api/rooms/active",{
  method:"POST",headers:{origin:"https://attacker.example"}
 })),OriginValidationError);
 assert.throws(()=>assertSameOrigin(new Request("https://weebie.example/api/rooms/active",{
  method:"GET",headers:{"sec-fetch-site":"cross-site"}
 })),OriginValidationError);
});

test("concurrent join and leave order never creates a negative or drifting count",()=>{
 const members=[member("a",{sessionId:"one"}),member("b",{sessionId:"one"})];
 const events=[
  {members:[member("a",{sessionId:"one"}),member("b",{sessionId:"one"})],sessions:[session("a","one"),session("b","one")]},
  {members:[member("a",{sessionId:"two"}),member("b",{sessionId:"one"})],sessions:[session("a","one",0,{online:false}),session("a","two"),session("b","one")]},
  {members:[member("a",{sessionId:"two"}),member("b",{sessionId:"one"})],sessions:[session("a","two"),session("b","one",0,{online:false})]},
  {members:[member("a",{sessionId:"two"}),member("b",{sessionId:"one"})],sessions:[session("a","two",0,{online:false}),session("b","one",0,{online:false})]}
 ];
 const counts=events.map(event=>activeRoomMembers(event.members,event.sessions,now).length);
 assert.deepEqual(counts,[2,2,1,0]);
 assert.ok(counts.every(count=>count>=0));
});

test("orphan leases and sessions not referenced by the member record never count active",()=>{
 const members=[member("offline",{online:false,sessionId:null}),member("different-tab",{sessionId:"current"})];
 const sessions=[session("offline","old"),session("different-tab","left-open")];
 assert.deepEqual(activeRoomMembers(members,sessions,now),[]);
});

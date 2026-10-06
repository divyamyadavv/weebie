const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {friendRequestId,friendConversationId,roomInvitationId,sendFriendRequest,respondToFriendRequest,deleteFriendship,blockUser,openFriendConversation,sendFriendMessage,sendRoomInvitation,kickRoomMember,markRoomInvitationsJoined,respondToRoomInvitation}=require("../functions/friendSystem.cjs");
const {subscribeRoomInvitations,roomInviteStatus}=require("../lib/roomInvitations.cjs");
const {isCurrentUserKicked}=require("../lib/roomKickNavigation.cjs");
const {friendRows,friendListenerFailure,subscribeFriendData}=require("../lib/friendSubscriptions.cjs");
const {claimFriendRequestPopup,claimNextFriendRequestPopup,friendRequestErrorMessage,sentFriendRequestStatus,friendRequestResponseStatus}=require("../lib/friendRequestUi.cjs");
const {FriendRequestApiError,executeFriendRequest}=require("../lib/friendRequestApi.cjs");
const {PRESENCE_STALE_AFTER_MS,isPresenceSessionActive,onlineFromSessions,activePresenceUids}=require("../lib/presenceSessions.cjs");

class MemoryFirestore{
 constructor(){this.records=new Map();this.sequence=0}
 doc(name){return {path:name,id:name.split("/").at(-1)}}
 async runTransaction(callback){
  const transaction={
   get:async ref=>{
    if(typeof ref.field==="string"){
     const docs=[...this.records.entries()].filter(([key,value])=>key.startsWith(`${ref.path}/`)&&value[ref.field]===ref.value).map(([key,value])=>({id:key.split("/").at(-1),ref:{path:key},data:()=>value}));
     return {docs};
    }
    return {exists:this.records.has(ref.path),data:()=>this.records.get(ref.path)};
   },
   set:(ref,data,options)=>this.records.set(ref.path,options?.merge?{...this.records.get(ref.path),...data}:{...data}),
   update:(ref,data)=>this.records.set(ref.path,{...this.records.get(ref.path),...data}),
   delete:ref=>this.records.delete(ref.path)
  };
  return callback(transaction);
 }
 collection(path){
  const db=this;
  return {where(field,operator,value){return {path,field:operator==="=="?field:null,value,get:async()=>({docs:[...db.records.entries()].filter(([key,data])=>key.startsWith(`${path}/`)&&(operator!=="=="||data[field]===value)).map(([key,data])=>({id:key.split("/").at(-1),ref:{path:key},data:()=>data}))})}}};
 }
 timestamp(){return `time-${++this.sequence}`}
}

function requestData(db){
 return [...db.records.entries()].filter(([key])=>key.startsWith("friendRequests/")).map(([id,data])=>({id:id.split("/").at(-1),...data}));
}

function realtimeSdk(){
 const listeners=[];
 const snapshotFor=(db,query)=>{
  const docs=[...db.records.entries()].filter(([key])=>key.startsWith(`${query.path}/`)).filter(([,value])=>query.conditions.every(condition=>value[condition.field]===condition.value)).map(([key,value])=>({id:key.split("/").at(-1),data:()=>value}));
  return {docs};
 };
 const modular={
  collection:(db,...segments)=>({db,path:segments.join("/"),conditions:[]}),
  where:(field,operator,value)=>({field,operator,value}),
  query:(collection,...conditions)=>({...collection,conditions}),
  onSnapshot:(query,next,error)=>{const listener={query,next,error};listeners.push(listener);next(snapshotFor(query.db,query));return()=>listeners.splice(listeners.indexOf(listener),1)}
 };
 const publish=db=>listeners.forEach(listener=>listener.next(snapshotFor(db,listener.query)));
 const fail=(index,error)=>listeners[index].error(error);
 return {modular,publish,fail,listeners};
}

const senderToken={name:"User A",picture:"https://example.test/a.png"};
const timestamp=()=>"server-time";
const send=(db,uid,recipientUid,token=senderToken,recipientDisplayName="User B")=>sendFriendRequest({db,uid,token,data:{recipientUid,recipientDisplayName},serverTimestamp:timestamp});
const apiRequest=(db,user,body)=>executeFriendRequest({db,user,body,getUser:async uid=>({uid,displayName:`User ${uid}`,photoURL:null}),serverTimestamp:timestamp});

test("User A sends a UID-based request that User B receives through the live Firestore listener",async()=>{
 const db=new MemoryFirestore(),{modular,publish}=realtimeSdk(),received=[];
 subscribeFriendData(modular,db,"B",{onIncoming:rows=>received.push(rows),onOutgoing:()=>{},onFriends:()=>{},onError:error=>{throw error}});
 await send(db,"A","B");
 publish(db);
 assert.equal(received.at(-1).length,1);
 assert.deepEqual(received.at(-1)[0],{id:friendRequestId("A","B"),senderUid:"A",senderDisplayName:"User A",senderPhotoURL:"https://example.test/a.png",recipientUid:"B",recipientDisplayName:"User B",status:"pending",createdAt:"server-time"});
});

test("live subscriptions notify both simulated devices without reloading",async()=>{
 const db=new MemoryFirestore(),{modular,publish}=realtimeSdk(),deviceOne=[],deviceTwo=[];
 for(const received of [deviceOne,deviceTwo])subscribeFriendData(modular,db,"B",{onIncoming:rows=>received.push(rows),onOutgoing:()=>{},onFriends:()=>{},onError:error=>{throw error}});
 await send(db,"A","B");
 publish(db);
 assert.equal(deviceOne.at(-1).length,1);
 assert.equal(deviceTwo.at(-1).length,1);
});

test("room invitation status updates live for revocation, membership, departure, and a fresh invite",()=>{
 const db=new MemoryFirestore(),{modular,publish}=realtimeSdk(),states=[];
 db.records.set("roomInvitations/invite-old",{senderUid:"A",recipientUid:"B",roomId:"ABC123",status:"pending",createdAt:30});
 db.records.set("roomInvitations/other-room",{senderUid:"A",recipientUid:"C",roomId:"XYZ987",status:"pending",createdAt:30});
 db.records.set("roomInvitations/other-sender",{senderUid:"C",recipientUid:"B",roomId:"ABC123",status:"pending"});
 const unsubscribe=subscribeRoomInvitations(modular,db,"A","ABC123",{onInvitations:items=>states.push(items),onError:error=>{throw error}});
 const active=new Set();
 assert.equal(roomInviteStatus("B",active,states.at(-1)),"invited");
 assert.equal(roomInviteStatus("B",active,states.at(-1),{B:{lastSeen:20}}),"invited");
 assert.equal(roomInviteStatus("B",active,states.at(-1),{B:{lastSeen:40}}),"invite");
 db.records.set("roomInvitations/invite-old",{...db.records.get("roomInvitations/invite-old"),status:"revoked"});
 publish(db);
 assert.equal(roomInviteStatus("B",active,states.at(-1)),"invite");
 db.records.set("roomInvitations/invite-new",{senderUid:"A",recipientUid:"B",roomId:"ABC123",status:"pending",createdAt:50});
 publish(db);
 assert.equal(roomInviteStatus("B",active,states.at(-1)),"invited");
 assert.equal(roomInviteStatus("B",active,states.at(-1),{B:{kicked:true,reinviteInvitationId:"invite-new"}}),"invited");
 assert.equal(roomInviteStatus("B",active,states.at(-1),{B:{kicked:true,reinviteInvitationId:"different-invite"}}),"invite");
 active.add("B");
 assert.equal(roomInviteStatus("B",active,states.at(-1)),"member");
 active.delete("B");
 db.records.set("roomInvitations/invite-new",{...db.records.get("roomInvitations/invite-new"),status:"joined"});
 publish(db);
 assert.equal(roomInviteStatus("B",active,states.at(-1)),"invite");
 unsubscribe();
 const reopened=[];
 const closeReopened=subscribeRoomInvitations(modular,db,"A","ABC123",{onInvitations:items=>reopened.push(items),onError:error=>{throw error}});
 assert.equal(roomInviteStatus("B",active,reopened.at(-1)),"invite");
 db.records.set("roomInvitations/invite-after-reopen",{senderUid:"A",recipientUid:"B",roomId:"ABC123",status:"pending",createdAt:60});
 publish(db);
 assert.equal(roomInviteStatus("B",active,reopened.at(-1)),"invited");
 closeReopened();
});

test("only a kick targeting the current user triggers room kick navigation",()=>{
 assert.equal(isCurrentUserKicked("A","A","kick"),true);
 assert.equal(isCurrentUserKicked("A","B","kick"),false);
 assert.equal(isCurrentUserKicked("A","A","leave"),false);
 assert.equal(isCurrentUserKicked("A","A","block"),false);
});

test("friend listeners use UID-scoped queries and identify permission failures without logging UIDs",()=>{
 const db=new MemoryFirestore(),{modular,fail,listeners}=realtimeSdk(),errors=[];
 subscribeFriendData(modular,db,"private-user-uid",{onIncoming:()=>{},onOutgoing:()=>{},onFriends:()=>{},onError:(error,source)=>errors.push({error,source})});
 assert.deepEqual(listeners.map(({query})=>({path:query.path,conditions:query.conditions})),[
  {path:"friendRequests",conditions:[{field:"recipientUid",operator:"==",value:"private-user-uid"}]},
  {path:"friendRequests",conditions:[{field:"senderUid",operator:"==",value:"private-user-uid"}]},
  {path:"users/private-user-uid/friends",conditions:[]}
 ]);
 fail(0,{code:"permission-denied",message:"Missing or insufficient permissions."});
 assert.deepEqual(errors[0],{
  error:{code:"permission-denied",message:"Missing or insufficient permissions."},
  source:{listener:"Incoming friend requests",path:"friendRequests (recipientUid == current user)"}
 });
 assert.doesNotMatch(JSON.stringify(errors[0].source),/private-user-uid/);
});

test("permission diagnostics identify listener, templated path, and code without exposing raw errors",()=>{
 const failure=friendListenerFailure(
  {code:"permission-denied",message:"private-user-uid Missing or insufficient permissions."},
  {listener:"Accepted friendships",path:"users/{currentUserUid}/friends"}
 );
 assert.deepEqual(failure,{
  diagnostic:{listener:"Accepted friendships",path:"users/{currentUserUid}/friends",code:"permission-denied"},
  message:"Accepted friendships: Firestore denied access. Confirm the deployed rules allow this signed-in user to read the listener path."
 });
 assert.doesNotMatch(JSON.stringify(failure),/private-user-uid|Missing or insufficient permissions/);
 assert.equal(friendListenerFailure({code:"permission denied"},{listener:"Friends",path:"users/{currentUserUid}/friends"}).diagnostic.code,"unknown");
});

test("existing pending requests survive reload and remain backed by Firestore",async()=>{
 const db=new MemoryFirestore();
 await send(db,"A","B");
 const {modular}=realtimeSdk(),restored=[];
 subscribeFriendData(modular,db,"B",{onIncoming:rows=>restored.push(rows),onOutgoing:()=>{},onFriends:()=>{},onError:error=>{throw error}});
 assert.equal(requestData(db)[0].status,"pending");
 assert.equal(restored[0].length,1);
});

test("accept atomically marks accepted and creates friendship records for both UIDs",async()=>{
 const db=new MemoryFirestore();
 await send(db,"A","B");
 const result=await respondToFriendRequest({db,uid:"B",token:{name:"User B",picture:"https://example.test/b.png"},requestId:friendRequestId("A","B"),action:"accept",serverTimestamp:timestamp});
 assert.equal(result.status,"accepted");
 assert.equal(db.records.get(`friendRequests/${friendRequestId("A","B")}`).status,"accepted");
 assert.equal(db.records.get("users/A/friends/B").name,"User B");
 assert.equal(db.records.get("users/B/friends/A").name,"User A");
});

test("reject marks the request rejected without creating friendship records",async()=>{
 const db=new MemoryFirestore(),{modular,publish}=realtimeSdk(),senderUpdates=[];
 await send(db,"A","B");
 subscribeFriendData(modular,db,"A",{onIncoming:()=>{},onOutgoing:rows=>senderUpdates.push(rows),onFriends:()=>{},onError:error=>{throw error}});
 await respondToFriendRequest({db,uid:"B",token:{},requestId:friendRequestId("A","B"),action:"reject",serverTimestamp:timestamp});
 publish(db);
 assert.equal(db.records.get(`friendRequests/${friendRequestId("A","B")}`).status,"rejected");
 assert.equal(senderUpdates.at(-1)[0].status,"rejected");
 assert.equal(db.records.has("users/A/friends/B"),false);
});

test("retries reuse the same document and do not create duplicate pending requests",async()=>{
 const db=new MemoryFirestore();
 const first=await send(db,"A","B"),second=await send(db,"A","B");
 assert.equal(first.status,"sent");
 assert.equal(second.status,"pending");
 assert.equal(requestData(db).length,1);
});

test("self-requests are rejected",async()=>{
 await assert.rejects(()=>send(new MemoryFirestore(),"A","A"),/valid recipient account/);
});

test("already-friends requests are rejected",async()=>{
 const db=new MemoryFirestore();
 db.records.set("users/A/friends/B",{uid:"B"});
 assert.equal((await send(db,"A","B")).status,"already-friends");
 assert.equal(requestData(db).length,0);
 assert.equal(db.records.get("users/B/friends/A").uid,"A");
 assert.equal(db.records.get("users/B/friends/A").name,"User A");
});

test("an existing reverse friendship is repaired before returning already-friends",async()=>{
 const db=new MemoryFirestore();
 db.records.set("users/B/friends/A",{uid:"A",name:"User A",photoURL:null,online:false,acceptedAt:"existing-time"});
 assert.equal((await send(db,"A","B",senderToken,"User B")).status,"already-friends");
 assert.equal(db.records.get("users/A/friends/B").uid,"B");
 assert.equal(db.records.get("users/A/friends/B").name,"User B");
 assert.equal(db.records.get("users/A/friends/B").acceptedAt,"existing-time");
});

test("an opposite-direction pending request is accepted instead of duplicated",async()=>{
 const db=new MemoryFirestore();
 await send(db,"B","A",{name:"User B",picture:null},"User A");
 const result=await send(db,"A","B");
 assert.equal(result.status,"accepted");
 assert.equal(requestData(db).length,1);
 assert.equal(requestData(db)[0].status,"accepted");
 assert.equal(db.records.has("users/A/friends/B"),true);
 assert.equal(db.records.has("users/B/friends/A"),true);
});

test("accepted friendship documents appear in each user's accepted-friends listener",async()=>{
 const db=new MemoryFirestore();
 await send(db,"A","B");
 await respondToFriendRequest({db,uid:"B",token:{name:"User B",picture:"https://example.test/b.png"},requestId:friendRequestId("A","B"),action:"accept",serverTimestamp:timestamp});
 const {modular}=realtimeSdk(),lists={A:[],B:[]};
 for(const uid of ["A","B"])subscribeFriendData(modular,db,uid,{onIncoming:()=>{},onOutgoing:()=>{},onFriends:rows=>lists[uid].push(rows),onError:error=>{throw error}});
 assert.deepEqual(lists.A.at(-1).map(friend=>({id:friend.id,uid:friend.uid,name:friend.name})),[{id:"B",uid:"B",name:"User B"}]);
 assert.deepEqual(lists.B.at(-1).map(friend=>({id:friend.id,uid:friend.uid,name:friend.name})),[{id:"A",uid:"A",name:"User A"}]);
 assert.deepEqual(friendRows({docs:[{id:"B",data:()=>({id:"wrong",uid:"B"})}]}),[{id:"B",uid:"B"}]);
});

test("only the intended recipient can accept or reject a pending request",async()=>{
 const db=new MemoryFirestore();
 await send(db,"A","B");
 const requestId=friendRequestId("A","B");
 await assert.rejects(()=>respondToFriendRequest({db,uid:"C",token:{},requestId,action:"accept"}),/no longer pending/);
 await assert.rejects(()=>respondToFriendRequest({db,uid:"A",token:{},requestId,action:"reject"}),/no longer pending/);
 assert.equal(db.records.get(`friendRequests/${requestId}`).status,"pending");
 assert.equal(db.records.has("users/A/friends/B"),false);
});

test("missing and completed requests cannot be responded to",async()=>{
 const db=new MemoryFirestore();
 await assert.rejects(()=>respondToFriendRequest({db,uid:"B",token:{},requestId:"missing",action:"accept"}),/no longer exists/);
 await send(db,"A","B");
 const requestId=friendRequestId("A","B");
 const respond=(action)=>respondToFriendRequest({db,uid:"B",token:{},requestId,action,serverTimestamp:timestamp});
 await respond("reject");
 await assert.rejects(()=>respond("accept"),/no longer pending/);
 assert.equal(db.records.get(`friendRequests/${requestId}`).status,"rejected");
});

test("server API derives the sender UID from the verified user, not the request body",async()=>{
 const db=new MemoryFirestore();
 const result=await apiRequest(db,{uid:"A",name:"User A"},{
  operation:"send",recipientUid:"B",senderUid:"forged-user",senderDisplayName:"Forged"
 });
 assert.equal(result.status,"sent");
 assert.equal(db.records.get(`friendRequests/${friendRequestId("A","B")}`).senderUid,"A");
 assert.equal(db.records.get(`friendRequests/${friendRequestId("A","B")}`).senderDisplayName,"User A");
});

test("acceptance derives both display identities from verified token claims instead of client labels",async()=>{
 const db=new MemoryFirestore();
 await apiRequest(db,{uid:"A",name:"Verified Sender"},{operation:"send",recipientUid:"B",recipientDisplayName:"Forged recipient label"});
 await apiRequest(db,{uid:"B"},{operation:"respond",requestId:friendRequestId("A","B"),action:"accept"});
 assert.equal(db.records.get("users/B/friends/A").name,"Verified Sender");
 assert.equal(db.records.get("users/A/friends/B").name,"Weebie");
});

test("server API supports accept, reject, duplicate, and reverse-request operations",async()=>{
 const db=new MemoryFirestore();
 assert.equal((await apiRequest(db,{uid:"A",name:"User A"},{operation:"send",recipientUid:"B"})).status,"sent");
 assert.equal((await apiRequest(db,{uid:"A",name:"User A"},{operation:"send",recipientUid:"B"})).status,"pending");
 assert.equal((await apiRequest(db,{uid:"B",name:"User B"},{operation:"send",recipientUid:"A"})).status,"accepted");
 assert.equal((await apiRequest(db,{uid:"C",name:"User C"},{operation:"send",recipientUid:"D"})).status,"sent");
 assert.equal((await apiRequest(db,{uid:"D",name:"User D"},{operation:"respond",requestId:friendRequestId("C","D"),action:"reject"})).status,"rejected");
});

test("server API rejects unauthenticated or malformed friend request operations",async()=>{
 const db=new MemoryFirestore();
 await assert.rejects(()=>apiRequest(db,null,{operation:"send",recipientUid:"B"}),error=>error instanceof FriendRequestApiError&&error.status===401);
 await assert.rejects(()=>apiRequest(db,{uid:"A"},{}),error=>error instanceof FriendRequestApiError&&error.status===400);
 await assert.rejects(()=>apiRequest(db,{uid:"A"},{operation:"respond",requestId:"x",action:"approve"}),error=>error instanceof FriendRequestApiError&&error.status===400);
 await assert.rejects(()=>apiRequest(db,{uid:"A"},{operation:"respond",requestId:"x",action:"accept"}),error=>error instanceof FriendRequestApiError&&error.status===400);
 await assert.rejects(()=>executeFriendRequest({db,user:{uid:"A"},body:{operation:"send",recipientUid:"missing"},getUser:async()=>{const error=new Error("missing");error.code="auth/user-not-found";throw error},serverTimestamp:timestamp}),error=>error instanceof FriendRequestApiError&&error.status===404);
 await assert.rejects(()=>apiRequest(db,{uid:"A"},{operation:"send",recipientUid:"A"}),error=>error instanceof FriendRequestApiError&&error.status===400);
});

test("one popup is claimed at a time, later requests advance, and deciding later leaves a request pending",()=>{
 const data=new Map(),storage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},requests=[{id:"request-1",status:"pending"},{id:"request-2",status:"pending"}];
 assert.equal(claimNextFriendRequestPopup(requests,storage).id,"request-1");
 assert.equal(claimNextFriendRequestPopup(requests,storage,"request-1").id,"request-2");
 assert.equal(claimNextFriendRequestPopup(requests,storage),null);
 assert.deepEqual(requests.map(item=>item.status),["pending","pending"]);
 assert.equal(claimFriendRequestPopup({...requests[0],createdAt:"new-request"},storage),true);
 assert.equal(claimFriendRequestPopup(requests[0],{getItem:()=>{throw new Error("storage unavailable")},setItem:()=>{}}),true);
});

test("fresh session leases aggregate across tabs and expire instead of trusting a stale online flag",()=>{
 const now=200000,sessions=[{uid:"A",online:true,lastSeen:now-10000},{uid:"A",online:false,lastSeen:now},{uid:"B",online:true,lastSeen:now-PRESENCE_STALE_AFTER_MS-1}];
 assert.equal(isPresenceSessionActive(sessions[0],now),true);
 assert.equal(onlineFromSessions(sessions.filter(item=>item.uid==="A"),now),true);
 assert.deepEqual([...activePresenceUids(sessions,now)],["A"]);
 assert.equal(onlineFromSessions([{online:true,lastSeen:now-PRESENCE_STALE_AFTER_MS}],now),false);
 assert.equal(isPresenceSessionActive({online:true,lastSeen:now+60000},now),false);
});

test("delete friendship removes both one-sided relationship records",async()=>{
 const db=new MemoryFirestore();
 db.records.set("users/A/friends/B",{uid:"B"});
 db.records.set("users/B/friends/A",{uid:"A"});
 assert.deepEqual(await deleteFriendship({db,uid:"A",friendUid:"B"}),{status:"deleted"});
 assert.equal(db.records.has("users/A/friends/B"),false);
 assert.equal(db.records.has("users/B/friends/A"),false);
});

test("blocking removes both friendship records, closes pending requests, and blocks future requests",async()=>{
 const db=new MemoryFirestore();
 await send(db,"A","B");
 db.records.set("users/A/friends/B",{uid:"B"});
 db.records.set("users/B/friends/A",{uid:"A"});
 assert.deepEqual(await blockUser({db,uid:"B",friendUid:"A",serverTimestamp:timestamp}),{status:"blocked"});
 assert.equal(db.records.has("users/A/friends/B"),false);
 assert.equal(db.records.has("users/B/friends/A"),false);
 assert.equal(db.records.get(`friendRequests/${friendRequestId("A","B")}`).status,"blocked");
 await assert.rejects(()=>apiRequest(db,{uid:"A",name:"User A"},{operation:"send",recipientUid:"B"}),error=>error instanceof FriendRequestApiError&&error.status===403);
});

test("private chat is created and sent only while both accepted friendship records remain",async()=>{
 const db=new MemoryFirestore();
 db.records.set("users/A/friends/B",{uid:"B"});
 db.records.set("users/B/friends/A",{uid:"A"});
 const open=await apiRequest(db,{uid:"A",name:"User A"},{operation:"openChat",friendUid:"B"});
 assert.equal(open.conversationId,friendConversationId("A","B"));
 assert.deepEqual(db.records.get(`conversations/${open.conversationId}`).participants,["A","B"]);
 const sent=await apiRequest(db,{uid:"B",name:"User B"},{operation:"sendMessage",friendUid:"A",text:"Hello"});
 const stored=db.records.get(`conversations/${sent.conversationId}/messages/${sent.messageId}`);
 assert.equal(stored.senderUid,"B");
 assert.equal(stored.text,"Hello");
 db.records.delete("users/A/friends/B");
 await assert.rejects(()=>apiRequest(db,{uid:"B",name:"User B"},{operation:"sendMessage",friendUid:"A",text:"Blocked access"}),error=>error instanceof FriendRequestApiError&&error.status===403);
});

test("room invitations require live inviter presence and accepted friendship, while admin re-invites are explicit and per-user",async()=>{
 const db=new MemoryFirestore(),now=Date.now();
 db.records.set("users/A/friends/B",{uid:"B"});
 db.records.set("users/B/friends/A",{uid:"A"});
 db.records.set("rooms/ABC123",{name:"Movie night",adminId:"A"});
 db.records.set("rooms/ABC123/members/A",{uid:"A",online:true,kicked:false,sessionId:"tab",lastSeen:now});
 db.records.set("rooms/ABC123/presenceSessions/A_tab",{uid:"A",online:true,lastSeen:now});
 const invite=await sendRoomInvitation({db,uid:"A",friendUid:"B",roomId:"ABC123",token:{name:"User A"},serverTimestamp:timestamp,now});
 assert.equal(invite.status,"sent");
 const stored=db.records.get(`roomInvitations/${roomInvitationId("A","B","ABC123")}`);
 assert.equal(stored.senderName,"User A");
 assert.equal(stored.roomName,"Movie night");
 db.records.set("users/A/friends/E",{uid:"E"});
 db.records.set("users/E/friends/A",{uid:"A"});
 db.records.set("rooms/ABC123/members/E",{uid:"E",online:true,kicked:false,sessionId:"tab",lastSeen:now});
 db.records.set("rooms/ABC123/presenceSessions/E_tab",{uid:"E",online:true,lastSeen:now});
 await assert.rejects(()=>sendRoomInvitation({db,uid:"A",friendUid:"E",roomId:"ABC123",token:{},serverTimestamp:timestamp,now}),/already in the room/);
 db.records.set("roomInvitations/E_pending",{senderUid:"A",recipientUid:"E",roomId:"ABC123",status:"pending"});
 assert.deepEqual(await apiRequest(db,{uid:"E",name:"User E"},{operation:"roomJoined",roomId:"ABC123"}),{status:"joined",updated:1});
 assert.equal(db.records.get("roomInvitations/E_pending").status,"joined");
 assert.deepEqual(await apiRequest(db,{uid:"B",name:"User B",email:"b@example.test"},{operation:"respondInvite",invitationId:invite.invitationId,action:"accept"}),{status:"accepted",roomId:"ABC123"});
 assert.equal(db.records.get(`roomInvitations/${invite.invitationId}`).status,"accepted");
 assert.equal(db.records.get("rooms/ABC123").adminId,"A");
 const acceptedMember=db.records.get("rooms/ABC123/members/B");
 assert.equal(acceptedMember.uid,"B");
 assert.equal(acceptedMember.name,"User B");
 assert.equal(acceptedMember.online,true);
 assert.equal(acceptedMember.kicked,false);
 assert.equal(acceptedMember.sessionId,null);
 assert.equal(db.records.get("users/B/rooms/ABC123").code,"ABC123");
 assert.deepEqual(await respondToRoomInvitation({db,uid:"B",token:{name:"User B"},invitationId:invite.invitationId,action:"accept",serverTimestamp:timestamp}),{status:"accepted",roomId:"ABC123"});
 assert.equal(db.records.get("rooms/ABC123/members/B").uid,"B");
 await assert.rejects(()=>respondToRoomInvitation({db,uid:"C",token:{},invitationId:invite.invitationId,action:"accept",serverTimestamp:timestamp}),/no longer pending/);
 db.records.set("users/C/friends/A",{uid:"A"});
 db.records.set("rooms/ABC123/presenceSessions/C_tab",{uid:"C",online:true,lastSeen:now});
 await assert.rejects(()=>sendRoomInvitation({db,uid:"A",friendUid:"C",roomId:"ABC123",token:{},serverTimestamp:timestamp,now}),/accepted friend/);
 db.records.set("users/A/friends/C",{uid:"C"});
 db.records.set("users/C/friends/A",{uid:"A"});
 db.records.set("rooms/ABC123/members/C",{uid:"C",name:"User C",kicked:false,online:true,sessionId:"tab",lastSeen:now});
 db.records.set("rooms/ABC123/presenceSessions/C_tab",{uid:"C",online:true,lastSeen:now});
 const oldInviteId=roomInvitationId("A","C","ABC123");
 db.records.set(`roomInvitations/${oldInviteId}`,{senderUid:"A",recipientUid:"C",roomId:"ABC123",status:"pending"});
 assert.deepEqual(await apiRequest(db,{uid:"A",name:"User A"},{operation:"kickRoomMember",roomId:"ABC123",targetUid:"C"}),{status:"kicked"});
 assert.equal(db.records.get("rooms/ABC123/members/C").kicked,true);
 assert.equal(db.records.get("rooms/ABC123/members/C").online,false);
 assert.equal(db.records.has("rooms/ABC123/presenceSessions/C_tab"),false);
 assert.equal(db.records.get(`roomInvitations/${oldInviteId}`).status,"revoked");
 await assert.rejects(()=>respondToRoomInvitation({db,uid:"C",token:{name:"User C"},invitationId:oldInviteId,action:"accept",serverTimestamp:timestamp}),/no longer pending/);
 const reinvite=await sendRoomInvitation({db,uid:"A",friendUid:"C",roomId:"ABC123",token:{name:"User A"},serverTimestamp:timestamp,now});
 assert.equal(reinvite.status,"sent");
 assert.notEqual(reinvite.invitationId,oldInviteId);
 assert.equal(db.records.get("rooms/ABC123/members/C").kicked,true);
 assert.equal(db.records.get("rooms/ABC123/members/C").reinviteInvitationId,reinvite.invitationId);
 const duplicate=await sendRoomInvitation({db,uid:"A",friendUid:"C",roomId:"ABC123",token:{name:"User A"},serverTimestamp:timestamp,now});
 assert.deepEqual(duplicate,{status:"pending",invitationId:reinvite.invitationId});
 db.records.set("rooms/ABC123/presenceSessions/C_old",{uid:"C",online:true,lastSeen:now});
 await respondToRoomInvitation({db,uid:"C",token:{name:"User C"},invitationId:reinvite.invitationId,action:"accept",serverTimestamp:timestamp});
 assert.equal(db.records.has("rooms/ABC123/presenceSessions/C_old"),false);
 assert.deepEqual(
  (({uid,name,kicked,online,sessionId,reinviteInvitationId})=>({uid,name,kicked,online,sessionId,reinviteInvitationId}))(db.records.get("rooms/ABC123/members/C")),
  {uid:"C",name:"User C",kicked:false,online:false,sessionId:null,reinviteInvitationId:null}
 );
 db.records.set("rooms/ABC123/members/D",{uid:"D",kicked:true,online:false});
 await assert.rejects(()=>sendRoomInvitation({db,uid:"A",friendUid:"D",roomId:"ABC123",token:{},serverTimestamp:timestamp,now}),/accepted friend/);
 assert.equal(db.records.get("rooms/ABC123/members/D").kicked,true);
 db.records.set("users/NonAdmin/friends/D",{uid:"D"});
 db.records.set("users/D/friends/NonAdmin",{uid:"NonAdmin"});
 db.records.set("rooms/ABC123/members/NonAdmin",{uid:"NonAdmin",online:true,kicked:false,sessionId:"tab",lastSeen:now});
 db.records.set("rooms/ABC123/presenceSessions/NonAdmin_tab",{uid:"NonAdmin",online:true,lastSeen:now});
 await assert.rejects(()=>apiRequest(db,{uid:"NonAdmin",name:"NonAdmin"},{operation:"kickRoomMember",roomId:"ABC123",targetUid:"C"}),error=>error instanceof FriendRequestApiError&&error.status===403);
 await assert.rejects(()=>apiRequest(db,{uid:"NonAdmin",name:"NonAdmin"},{operation:"invite",friendUid:"D",roomId:"ABC123"}),error=>error instanceof FriendRequestApiError&&error.status===403);
 assert.equal(db.records.get("rooms/ABC123/members/D").kicked,true);
 db.records.set("rooms/ABC123/members/A",{uid:"A",online:true,kicked:false});
 await assert.rejects(()=>sendRoomInvitation({db,uid:"A",friendUid:"B",roomId:"ABC123",token:{},serverTimestamp:timestamp,now:now+PRESENCE_STALE_AFTER_MS+1}),/Join this room/);
});

test("server API responses must confirm the expected status before the UI reports success",()=>{
 assert.equal(sentFriendRequestStatus({data:{status:"sent"}}),"sent");
 assert.equal(sentFriendRequestStatus({data:{status:"accepted"}}),"accepted");
 assert.equal(friendRequestResponseStatus({data:{status:"accepted"}},"accept"),"accepted");
 assert.equal(friendRequestResponseStatus({data:{status:"rejected"}},"reject"),"rejected");
 assert.throws(()=>sentFriendRequestStatus({data:{status:"pending"}}),/already pending/);
 assert.throws(()=>sentFriendRequestStatus({data:{status:"unknown"}}),/could not confirm/);
 assert.throws(()=>friendRequestResponseStatus({data:{status:"pending"}},"accept"),/could not confirm/);
});

test("friend request server API failures are presented as actionable messages",()=>{
 assert.match(friendRequestErrorMessage({status:404,message:"That friend request no longer exists."}),/no longer exists/);
 assert.match(friendRequestErrorMessage({status:409,message:"conflict"}),/no longer pending/);
 assert.match(friendRequestErrorMessage({status:503,message:"Firebase Admin is unavailable."}),/Firebase Admin is unavailable/);
 assert.match(friendRequestErrorMessage({code:"functions/unavailable"}),/Check your connection/);
 assert.match(friendRequestErrorMessage({code:"functions/unauthenticated"}),/verified Weebie account/);
 assert.equal(friendRequestErrorMessage({message:"Firebase: request failed"}),"request failed");
});

test("popup remains usable and Firebase-unavailable errors are surfaced",()=>{
 const root=path.join(__dirname,"..");
 const component=fs.readFileSync(path.join(root,"components/FriendRequests.js"),"utf8");
 const hook=fs.readFileSync(path.join(root,"lib/friends.js"),"utf8");
 const provider=fs.readFileSync(path.join(root,"components/AuthProvider.js"),"utf8");
 const shell=fs.readFileSync(path.join(root,"components/Shell.js"),"utf8");
 const room=fs.readFileSync(path.join(root,"app/room/[code]/page.js"),"utf8");
 const realtime=fs.readFileSync(path.join(root,"lib/realtime.js"),"utf8");
 const invites=fs.readFileSync(path.join(root,"components/RoomFriendInvites.js"),"utf8");
 const roomConnection=fs.readFileSync(path.join(root,"lib/firestoreRooms.js"),"utf8");
 assert.match(component,/role="dialog"/);
 assert.match(component,/Accept/);
 assert.match(component,/Decline/);
 assert.match(component,/Decide later/);
 assert.match(provider,/<FriendRequests\/>/);
 assert.match(provider,/<FriendsProvider user=\{verifiedUser\}>/);
 assert.doesNotMatch(shell,/FriendRequests/);
 assert.doesNotMatch(room,/FriendRequests/);
 assert.match(room,/Invite friends to this room/);
 assert.match(room,/if\(R\.moderation\.kicked\)router\.replace\("\/dashboard"\)/);
 assert.match(room,/R\.leave\(\);if\(R\.moderation\.kicked\)/);
 assert.match(roomConnection,/h\.applyModeration\(user\.uid,"kick"\)/);
 assert.match(invites,/subscribeRoomInvitations/);
 assert.match(invites,/roomInviteStatus\(friend\.id,activeMemberUids,pendingInvitations,memberActivity\)/);
 assert.match(roomConnection,/operation:"kickRoomMember",roomId:code,targetUid:targetId/);
 assert.match(hook,/isFirestoreReady/);
 assert.match(hook,/Firebase Authentication and Firestore are not configured/);
 const friendsPage=fs.readFileSync(path.join(__dirname,"..","app/friends/page.js"),"utf8");
 assert.match(friendsPage,/friendsStatus==="ready"/);
 assert.match(friendsPage,/Accepted friends could not be loaded/);
 assert.doesNotMatch(friendsPage,/Friends \(\{friends\.length\}\)/);
});

test("Firestore rules constrain request access and keep friendships server-managed",()=>{
 const rules=fs.readFileSync(path.join(__dirname,"..","firestore.rules"),"utf8");
 assert.match(rules,/resource\.data\.senderUid == request\.auth\.uid/);
 assert.match(rules,/resource\.data\.recipientUid == request\.auth\.uid/);
 assert.match(rules,/match \/friendRequests\/\{requestId\}/);
 assert.match(rules,/match \/users\/\{userId\}\/friends\/\{friendUid\}[\s\S]*?allow read: if signedIn\(\) && userId == request\.auth\.uid/);
 assert.match(rules,/allow create, update, delete: if false/);
 assert.match(rules,/match \/users\/\{userId\}\/presenceSessions\/\{sessionId\}/);
 assert.match(rules,/request\.resource\.data\.lastSeen == request\.time/);
 assert.match(rules,/function canChat\(firstUid, secondUid\)/);
 assert.match(rules,/match \/conversations\/\{conversationId\}/);
 assert.match(rules,/match \/roomInvitations\/\{invitationId\}/);
 assert.match(rules,/function isUnblocked\(firstUid, secondUid\)/);
 assert.doesNotMatch(rules,/allow read, write: if true/);
 const firebaseConfig=JSON.parse(fs.readFileSync(path.join(__dirname,"..","firebase.json"),"utf8"));
 assert.equal(firebaseConfig.firestore.rules,"firestore.rules");
 const subscriptions=fs.readFileSync(path.join(__dirname,"..","lib/friendSubscriptions.cjs"),"utf8");
 assert.match(subscriptions,/where\("recipientUid","==",uid\)/);
 assert.match(subscriptions,/where\("senderUid","==",uid\)/);
 assert.match(subscriptions,/collection\(db,"users",uid,"friends"\)/);
 assert.match(subscriptions,/onError\(error,\{listener,path\}\)/);
 assert.match(fs.readFileSync(path.join(__dirname,"..","functions/friendSystem.cjs"),"utf8"),/senderUid:uid/);
 const functionSource=fs.readFileSync(path.join(__dirname,"..","functions/index.js"),"utf8");
 assert.doesNotMatch(functionSource,/exports\.(sendFriendRequest|respondToFriendRequest)/);
 const route=fs.readFileSync(path.join(__dirname,"..","app/api/friends/route.js"),"utf8");
 assert.match(route,/verifyFirebaseIdToken\(request\)/);
 assert.match(route,/assertSameOrigin\(request\)/);
 assert.match(route,/runtime="nodejs"/);
});
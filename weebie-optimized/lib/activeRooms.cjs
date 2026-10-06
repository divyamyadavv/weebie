const {activeRoomMemberRecords} = require("./presenceSessions.cjs");

function activeRoomMembers(members, sessions, now = Date.now()) {
 return activeRoomMemberRecords(members,sessions,now)
  .map(member => ({
   name: typeof member.name === "string" && member.name.trim() ? member.name : "Member",
   photoURL: typeof member.photoURL === "string" ? member.photoURL : ""
  }));
}

function summarizeActiveRoom(roomId, room, members, sessions, now = Date.now(), viewerUid = null) {
 const activeRecords = activeRoomMemberRecords(members, sessions, now);
 if (activeRecords.length === 0) return null;
 const activeMembers = activeRecords.map(member => ({
  name: typeof member.name === "string" && member.name.trim() ? member.name : "Member",
  photoURL: typeof member.photoURL === "string" ? member.photoURL : ""
 }));
 let canReadRoster=!viewerUid;
 if(viewerUid)canReadRoster=activeRecords.some(member=>member.id===viewerUid);
 return {
  code: roomId,
  name: room.name || "Watch Room",
  members: activeRecords.length,
  activeMembers:canReadRoster?activeMembers:[],
  createdAt: room.createdAt?.toMillis?.() || 0
 };
}

function summarizePastRoom(roomId, room) {
 return {
  code: roomId,
  name: room.name || "Watch Room",
  members: 0,
  activeMembers: [],
  createdAt: room.createdAt?.toMillis?.() || 0
 };
}

function classifyRoomForUser(roomId, room, members, sessions, uid, now = Date.now()) {
 const actualActiveRoom=summarizeActiveRoom(roomId,room,members,sessions,now);
 if(!actualActiveRoom)return {activeRoom:null,pastRoom:summarizePastRoom(roomId,room)};
 return {
  activeRoom:summarizeActiveRoom(roomId,room,members,sessions,now,uid),
  pastRoom:null
 };
}

async function getActiveRoomsForUser(db, uid, now = Date.now()) {
 const memberships = await db.collection(`users/${uid}/rooms`).get();
 const rooms = await Promise.all(memberships.docs.map(async membership => {
  const roomId = membership.id;
  const [roomSnapshot, memberSnapshot, sessionSnapshot] = await Promise.all([
   db.doc(`rooms/${roomId}`).get(),
   db.collection(`rooms/${roomId}/members`).get(),
   db.collection(`rooms/${roomId}/presenceSessions`).get()
  ]);
  if (!roomSnapshot.exists) return null;
  const members = memberSnapshot.docs.map(doc => ({id: doc.id, data: doc.data()}));
  const sessions = sessionSnapshot.docs.map(doc => ({...doc.data(),documentId:doc.id}));
  return classifyRoomForUser(roomId,roomSnapshot.data(),members,sessions,uid,now);
 }));
 return {
  activeRooms: rooms.map(item => item?.activeRoom).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt),
  pastRooms: rooms.map(item => item?.pastRoom).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt)
 };
}

module.exports = {activeRoomMembers, summarizeActiveRoom, summarizePastRoom, classifyRoomForUser, getActiveRoomsForUser};

import {classifyRoomForUser} from "../../../../lib/activeRooms.cjs";
import {PRESENCE_STALE_AFTER_MS,timestampMillis} from "../../../../lib/presenceSessions.cjs";
import {reconcileRoomLeadership} from "../../../../functions/roomLeadership.cjs";
import {assertSameOrigin,getAdminServices,jsonError,verifyFirebaseIdToken} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;

export async function POST(request) {
 try {
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request),{db}=getAdminServices();
  const memberships=await db.collection(`users/${user.uid}/rooms`).get();
  const entries=await Promise.all(memberships.docs.map(async membership=>{
   const code=membership.id,room=await db.doc(`rooms/${code}`).get();
   if(!room.exists)return null;
   await reconcileRoomLeadership(db,code);
   const [memberSnapshot,sessionSnapshot]=await Promise.all([
    db.collection(`rooms/${code}/members`).get(),
    db.collection(`rooms/${code}/presenceSessions`).get()
   ]);
   const members=memberSnapshot.docs.map(doc=>({id:doc.id,data:doc.data()})),sessions=sessionSnapshot.docs.map(doc=>({...doc.data(),documentId:doc.id}));
   return classifyRoomForUser(code,room.data(),members,sessions,user.uid);
  }));
  return Response.json({
   activeRooms:entries.map(item=>item?.activeRoom).filter(Boolean),
   pastRooms:entries.map(item=>item?.pastRoom).filter(Boolean)
  },{headers:{"Cache-Control":"private, no-store"}});
 } catch(error) {
  return jsonError(error);
 }
}

export async function GET(request) {
 let streamController,closed=false,indexUnsubscribe=null,expiryTimer=null,heartbeatTimer=null,maxAgeTimer=null;
 const roomRecords=new Map();
 const encoder=new TextEncoder();
 const cleanup=()=>{
  if(closed)return;
  closed=true;
  if(indexUnsubscribe)indexUnsubscribe();
  for(const record of roomRecords.values())record.unsubscribers.forEach(unsubscribe=>unsubscribe());
  roomRecords.clear();
  clearTimeout(expiryTimer);clearInterval(heartbeatTimer);clearTimeout(maxAgeTimer);
 };
 const stream=new ReadableStream({
  start(controller){streamController=controller},
  cancel(){cleanup()}
 });
 const send=(payload,event="rooms")=>{
  if(closed)return;
  try{streamController.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))}
  catch{cleanup()}
 };
 try {
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request),{db}=getAdminServices();
  const recompute=()=>{
   if(closed)return;
   const now=Date.now(),activeRooms=[],pastRooms=[];
   for(const [code,record] of roomRecords){
    if(!record.room)continue;
    if(!record.membersReady||!record.sessionsReady)continue;
    const summary=classifyRoomForUser(code,record.room,record.members,record.sessions,user.uid,now);
    if(summary.activeRoom)activeRooms.push(summary.activeRoom);
    if(summary.pastRoom)pastRooms.push(summary.pastRoom);
   }
   activeRooms.sort((a,b)=>b.createdAt-a.createdAt);pastRooms.sort((a,b)=>b.createdAt-a.createdAt);
   const payload=JSON.stringify({activeRooms,pastRooms,status:[...roomRecords.values()].every(record=>record.ready)?"ready":"loading"});
   if(payload!==lastPayload){lastPayload=payload;send(JSON.parse(payload))}
   scheduleExpiry();
  };
  let lastPayload="";
  const scheduleExpiry=()=>{
   clearTimeout(expiryTimer);
   const now=Date.now();
   let next=Infinity;
   for(const record of roomRecords.values())for(const session of record.sessions){
    if(session.online!==true)continue;
    const expiresAt=timestampMillis(session.lastSeen)+PRESENCE_STALE_AFTER_MS+1;
    if(expiresAt>now&&expiresAt<next)next=expiresAt;
   }
   if(Number.isFinite(next))expiryTimer=setTimeout(()=>{
    void Promise.all([...roomRecords.keys()].map(code=>reconcileRoomLeadership(db,code))).then(recompute).catch(fail);
   },Math.max(10,next-now));
  };
  const fail=error=>{
   if(closed)return;
   send({error:error?.code==="permission-denied"?"Active rooms are not available for this account.":"Active rooms could not be updated."},"error");
   cleanup();
   try{streamController.close()}catch{}
  };
  const addRoom=async(code,indexData)=>{
   if(roomRecords.has(code))return;
   const record={room:null,members:[],sessions:[],membersReady:false,sessionsReady:false,ready:false,unsubscribers:[]};
   roomRecords.set(code,record);
   try{
    await reconcileRoomLeadership(db,code);
    if(closed||roomRecords.get(code)!==record)return;
    const roomSnapshot=await db.doc(`rooms/${code}`).get();
    if(closed||roomRecords.get(code)!==record)return;
    if(!roomSnapshot.exists){record.ready=true;recompute();return}
    record.room={...roomSnapshot.data(),name:roomSnapshot.data().name||indexData.name||"Watch Room"};
    record.unsubscribers.push(db.collection(`rooms/${code}/members`).onSnapshot(snapshot=>{
     record.members=snapshot.docs.map(doc=>({id:doc.id,data:doc.data()}));
     record.membersReady=true;record.ready=record.sessionsReady;recompute();
    },fail));
    record.unsubscribers.push(db.collection(`rooms/${code}/presenceSessions`).onSnapshot(snapshot=>{
     record.sessions=snapshot.docs.map(doc=>({...doc.data(),documentId:doc.id}));
     record.sessionsReady=true;record.ready=record.membersReady;recompute();
    },fail));
    recompute();
   }catch(error){fail(error)}
  };
  indexUnsubscribe=db.collection(`users/${user.uid}/rooms`).onSnapshot(snapshot=>{
   const ids=new Set(snapshot.docs.map(doc=>doc.id));
   for(const [code,record] of roomRecords)if(!ids.has(code)){
    record.unsubscribers.forEach(unsubscribe=>unsubscribe());roomRecords.delete(code);
   }
   for(const membership of snapshot.docs)void addRoom(membership.id,membership.data());
   recompute();
  },fail);
  heartbeatTimer=setInterval(()=>{if(!closed)try{streamController.enqueue(encoder.encode(": keepalive\n\n"))}catch{cleanup()}},25000);
  maxAgeTimer=setTimeout(()=>{cleanup();try{streamController.close()}catch{}},50*60*1000);
  return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"private, no-store, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"}});
 } catch(error) {
  cleanup();
  return jsonError(error);
 }
}

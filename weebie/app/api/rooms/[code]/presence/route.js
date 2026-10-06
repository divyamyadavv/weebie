import {reconcileRoomLeadership} from "../../../../../functions/roomLeadership.cjs";
import {assertSameOrigin,getAdminServices,HttpError,jsonError,verifyFirebaseIdToken} from "../../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request,{params}){
 try{
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request),roomId=String(params.code||"").toUpperCase();
  if(!/^[A-Z0-9]{6,20}$/.test(roomId))throw new HttpError(404,"Room not found.");
  let body;
  try{body=await request.json()}catch{throw new HttpError(400,"A room presence operation is required.")}
  const {db}=getAdminServices(),operation=body?.operation,sessionId=body?.sessionId;
  if(!["heartbeat","leave"].includes(operation)||typeof sessionId!=="string"||!sessionId||sessionId.length>128||sessionId.includes("/"))throw new HttpError(400,"A valid room presence session is required.");
  if(operation==="heartbeat"){
   const [room,member,session]=await Promise.all([
    db.doc(`rooms/${roomId}`).get(),
    db.doc(`rooms/${roomId}/members/${user.uid}`).get(),
    db.doc(`rooms/${roomId}/presenceSessions/${user.uid}_${sessionId}`).get()
   ]);
   if(!room.exists)throw new HttpError(404,"Room not found.");
   if(!member.exists||member.data().kicked===true||member.data().blocked===true)throw new HttpError(403,"You are not an active member of this room.");
   if(!session.exists||session.data().uid!==user.uid)throw new HttpError(409,"This room session is no longer active. Rejoin the room.");
  }
  const result=await reconcileRoomLeadership(db,roomId,{
   ...(operation==="heartbeat"?{heartbeatSession:{uid:user.uid,expectedUid:user.uid,sessionId}}:{leaveSession:{uid:user.uid,expectedUid:user.uid,sessionId}})
  });
  return Response.json({status:result.status,adminId:result.adminId,serverNow:Date.now()},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}

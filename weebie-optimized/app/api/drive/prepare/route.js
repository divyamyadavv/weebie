import {assertSameOrigin,getAdminServices,getRoomForMember,HttpError,jsonError,verifySession} from "../../../../lib/serverFirebase";
import {cleanupQualityArtifacts,prepareDriveQualitiesForRoom} from "../../../../lib/mediaQualityProcessing";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 let roomRef,source,roomCode,prepared,db;
 try{
  assertSameOrigin(request);
  const user=await verifySession(request),body=await request.json();
  const code=String(body.roomCode||"").toUpperCase();roomCode=code;
  if(!code)throw new HttpError(400,"A room code is required to prepare qualities.");
  db=getAdminServices().db;
  const result=await getRoomForMember(db,code,user.uid,{adminOnly:true}),room=result.room;
  roomRef=result.roomRef;source=room.source;
  if(!room.source||room.source.type!=="drive")throw new HttpError(400,"Only a Drive-backed room source can prepare quality variants.");
  await db.runTransaction(async transaction=>{
   const snapshot=await transaction.get(roomRef),current=snapshot.data();
   if(!snapshot.exists||current.source?.fileId!==source.fileId)throw new HttpError(409,"The room video changed before preparation started. Select the current video and retry.");
   transaction.update(roomRef,{"source.qualityStatus":"preparing"});
  });
  prepared=await prepareDriveQualitiesForRoom({roomCode:code,source,ownerUid:room.originalOwnerId||room.hostId||user.uid});
  await db.runTransaction(async transaction=>{
   const snapshot=await transaction.get(roomRef),current=snapshot.data();
   if(!snapshot.exists||current.source?.fileId!==source.fileId)throw new HttpError(409,"The room video changed during preparation; generated qualities were discarded.");
   const sourceWithoutSharedSelection={...current.source};
   delete sourceWithoutSharedSelection.quality;
   delete sourceWithoutSharedSelection.qualitySelected;
   transaction.update(roomRef,{source:{...sourceWithoutSharedSelection,qualityStatus:"ready",qualityGenerationId:prepared.qualityGenerationId,qualities:prepared.qualities,sourceTracks:prepared.sourceTracks,qualityWarnings:prepared.warnings,qualityUpdatedAt:Date.now(),sourceResolution:prepared.sourceResolution,duration:prepared.duration}});
  });
    if(room.source.qualityGenerationId&&room.source.qualityGenerationId!==prepared.qualityGenerationId)await cleanupQualityArtifacts(code,room.source.qualityGenerationId);
  return Response.json({ok:true,status:"ready",qualities:prepared.qualities,sourceResolution:prepared.sourceResolution,warnings:prepared.warnings}, {headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(prepared?.qualityGenerationId&&roomCode&&source?.type==="drive")await cleanupQualityArtifacts(roomCode,prepared.qualityGenerationId);
  if(db&&roomRef&&source?.type==="drive")await db.runTransaction(async transaction=>{
   const snapshot=await transaction.get(roomRef),current=snapshot.data();
   if(snapshot.exists&&current.source?.fileId===source.fileId&&current.source.qualityStatus==="preparing")transaction.update(roomRef,{"source.qualityStatus":"failed"});
  }).catch(()=>{});
  return jsonError(error);
 }
}

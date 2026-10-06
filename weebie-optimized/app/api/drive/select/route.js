import {selectDriveVideo} from "../../../../lib/driveServer";
import {assertSameOrigin,getAdminServices,getRoomForMember,HttpError,jsonError,verifySession} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 try{
  assertSameOrigin(request);
  const user=await verifySession(request),body=await request.json();
  if(body.roomCode){
   const {db}=getAdminServices(),{room}=await getRoomForMember(db,String(body.roomCode).toUpperCase(),user.uid,{adminOnly:true});
    if((room.originalOwnerId||room.hostId)!==user.uid)throw new HttpError(403,"Only the room creator can select its Drive video.");
  }
  return Response.json({video:{...(await selectDriveVideo(user.uid,body.fileId)),driveOwnerUid:user.uid}},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}
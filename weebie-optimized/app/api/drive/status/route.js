import {hasDriveGrant,serverDriveConfig} from "../../../../lib/driveServer";
import {jsonError,verifySession} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request){
 try{
  const user=await verifySession(request);
  try{serverDriveConfig()}catch(error){return Response.json({configured:false,connected:false,error:error.message},{status:error.status||503,headers:{"Cache-Control":"no-store"}})}
  return Response.json({configured:true,connected:await hasDriveGrant(user.uid)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}
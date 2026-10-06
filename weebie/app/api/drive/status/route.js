import {hasDriveGrant,logDriveFailure,serverDriveConfig} from "../../../../lib/driveServer";
import {jsonError,verifySession} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request){
 let stage="session";
 try{
  const user=await verifySession(request);
  stage="configuration";
  try{serverDriveConfig()}catch(error){logDriveFailure("status",stage,error);return Response.json({configured:false,connected:false,error:error.message},{status:error.status||503,headers:{"Cache-Control":"no-store"}})}
  stage="grant_lookup";
  return Response.json({configured:true,connected:await hasDriveGrant(user.uid)},{headers:{"Cache-Control":"no-store"}});
 }catch(error){logDriveFailure("status",stage,error);return jsonError(error)}
}
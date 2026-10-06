import {listDriveVideos,logDriveFailure} from "../../../../lib/driveServer";
import {jsonError,verifySession} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request){
 let stage="session";
 try{
  const user=await verifySession(request),pageToken=new URL(request.url).searchParams.get("pageToken");
  stage="file_listing";
  return Response.json(await listDriveVideos(user.uid,pageToken||undefined),{headers:{"Cache-Control":"no-store"}});
 }catch(error){logDriveFailure("files",stage,error);return jsonError(error)}
}
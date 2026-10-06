import {createReadStream} from "node:fs";
import path from "node:path";
import {authorizeRoomHlsAsset} from "../../../../../../../lib/roomHlsAccess.cjs";
import {isPresenceSessionActive} from "../../../../../../../lib/presenceSessions.cjs";
import {qualityGenerationDirectory} from "../../../../../../../lib/mediaQualityProcessing";
import {getAdminServices,HttpError,jsonError,verifySession} from "../../../../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;

export async function GET(request,{params}){
 try{
  const user=await verifySession(request),{db}=getAdminServices(),code=String(params.code).toUpperCase();
  const [roomSnapshot,memberSnapshot,sessionSnapshot]=await Promise.all([db.doc(`rooms/${code}`).get(),db.doc(`rooms/${code}/members/${user.uid}`).get(),db.collection(`rooms/${code}/presenceSessions`).where("uid","==",user.uid).get()]);
  const room=roomSnapshot.exists?roomSnapshot.data():null,member=memberSnapshot.exists?memberSnapshot.data():null;
  const asset=Array.isArray(params.asset)?params.asset:[];
  const activeSession=sessionSnapshot.docs.some(session=>isPresenceSessionActive(session.data()));
  const access=authorizeRoomHlsAsset({uid:user.uid,room,member,activeSession,asset});
  if(!access.ok)throw new HttpError(access.status,access.message);
  const directory=qualityGenerationDirectory(code,access.generationId);
  const filePath=path.resolve(directory,...asset),prefix=`${path.resolve(directory)}${path.sep}`;
  if(!filePath.startsWith(prefix))throw new HttpError(404,"This HLS asset is not available.");
  let info;
  try{info=await import("node:fs/promises").then(fs=>fs.stat(filePath))}catch{throw new HttpError(503,"Prepared HLS media is missing from this server. Quality storage must persist across requests and deployments.")}
  if(!info.isFile())throw new HttpError(404,"This HLS asset is not available.");
  const extension=path.extname(filePath),mime=extension===".m3u8"?"application/vnd.apple.mpegurl":extension===".ts"?"video/mp2t":extension===".vtt"?"text/vtt":"application/octet-stream";
  return new Response(createReadStream(filePath),{status:200,headers:{"Content-Type":mime,"Content-Length":String(info.size),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"}});
 }catch(error){return jsonError(error)}
}

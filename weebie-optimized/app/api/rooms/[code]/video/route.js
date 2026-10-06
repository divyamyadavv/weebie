import {parseByteRange,parseContentRange} from "../../../../../lib/byteRange.cjs";
import {authorizeRoomVideo} from "../../../../../lib/roomVideoAccess.cjs";
import {isPresenceSessionActive} from "../../../../../lib/presenceSessions.cjs";
import {streamDriveFile} from "../../../../../lib/driveServer";
import {getAdminServices,HttpError,jsonError,verifySession} from "../../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;

export async function GET(request,{params}){
 try{
  const user=await verifySession(request),{db}=getAdminServices(),code=String(params.code).toUpperCase();
  const [roomSnapshot,memberSnapshot,sessionSnapshot]=await Promise.all([db.doc(`rooms/${code}`).get(),db.doc(`rooms/${code}/members/${user.uid}`).get(),db.collection(`rooms/${code}/presenceSessions`).where("uid","==",user.uid).get()]);
  const room=roomSnapshot.exists?roomSnapshot.data():null,member=memberSnapshot.exists?memberSnapshot.data():null;
  const activeSession=sessionSnapshot.docs.some(session=>isPresenceSessionActive(session.data()));
  const access=authorizeRoomVideo({uid:user.uid,room,member,activeSession});
  if(!access.ok)throw new HttpError(access.status,access.message);
  const {ownerUid,fileId,size}=access,range=parseByteRange(request.headers.get("range"),size);
  if(range?.invalid)return new Response(null,{status:416,headers:{...(size>0?{"Content-Range":`bytes */${size}`} : {}),"Accept-Ranges":"bytes","Cache-Control":"no-store"}});
  const streamed=await streamDriveFile(ownerUid,fileId,range?.header||null),upstream=streamed.response;
  if(range&&upstream.status===416){
   await upstream.body?.cancel();
   const contentRange=upstream.headers.get("content-range");
   return new Response(null,{status:416,headers:{...(contentRange?{"Content-Range":contentRange}:{}),"Accept-Ranges":"bytes","Cache-Control":"private, no-store"}});
  }
  const headers=new Headers({"Content-Type":streamed.mime,"Accept-Ranges":"bytes","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":"inline"});
  if(range){
   const contentRange=upstream.headers.get("content-range"),parsed=parseContentRange(contentRange,range);
   if(!parsed){await upstream.body?.cancel();throw new HttpError(502,"Google Drive returned an invalid byte-range response.")}
   headers.set("Content-Range",contentRange);
   headers.set("Content-Length",upstream.headers.get("content-length")||String(parsed.length));
  }else{
   const length=upstream.headers.get("content-length")||String(streamed.size||"");
   if(length)headers.set("Content-Length",length);
  }
  return new Response(upstream.body,{status:range?206:200,headers});
 }catch(error){return jsonError(error)}
}

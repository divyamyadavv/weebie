import {reconcileRoomLeadership} from "../../../../functions/roomLeadership.cjs";
import {deleteAccountData,isRecentSignIn} from "../../../../lib/accountDeletion.cjs";
import {removeDriveGrant} from "../../../../lib/driveServer";
import {assertSameOrigin,clearSessionCookie,getAdminServices,HttpError,jsonError,verifyFirebaseIdToken} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 try{
  assertSameOrigin(request);
  const decoded=await verifyFirebaseIdToken(request);
  if(!isRecentSignIn(decoded))throw new HttpError(401,"For your security, confirm your sign-in again before deleting your account.");
  let body;
  try{body=await request.json()}catch{throw new HttpError(400,"Type DELETE to confirm.")}
  if(body?.confirmation!=="DELETE")throw new HttpError(400,"Type DELETE to confirm.");
  const {db,auth}=getAdminServices();
  await deleteAccountData({
   db,auth,uid:decoded.uid,removeDriveGrant,
   reconcileRoom:roomId=>reconcileRoomLeadership(db,roomId),
   log:(event,id,code)=>console.warn(`[account-delete] ${event}`,id,code)
  });
  const cleared=clearSessionCookie();
  return Response.json({deleted:true},{headers:{"Set-Cookie":cleared.headers.get("Set-Cookie"),"Cache-Control":"no-store"}});
 }catch(error){
  if(!(error instanceof HttpError))console.error("[account-delete] failed",error?.code||"unknown");
  return jsonError(error);
 }
}

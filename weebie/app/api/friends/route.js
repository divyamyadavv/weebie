import {FieldValue} from "firebase-admin/firestore";
import {assertSameOrigin,getAdminServices,HttpError,jsonError,verifyFirebaseIdToken} from "../../../lib/serverFirebase";
import friendRequestApi from "../../../lib/friendRequestApi.cjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 try{
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request);
  let body;
  try{body=await request.json()}catch{throw new HttpError(400,"A valid friend request payload is required.")}
  const {auth,db}=getAdminServices();
  const result=await friendRequestApi.executeFriendRequest({
   body,
   user,
   db,
   getUser:uid=>auth.getUser(uid),
   serverTimestamp:()=>FieldValue.serverTimestamp()
  });
  return Response.json({data:result},{headers:{"Cache-Control":"no-store"}});
 }catch(error){
  if(error instanceof friendRequestApi.FriendRequestApiError)return jsonError(new HttpError(error.status,error.message));
  return jsonError(error);
 }
}

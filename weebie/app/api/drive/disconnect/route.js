import {removeDriveGrant} from "../../../../lib/driveServer";
import {assertSameOrigin,jsonError,verifyFirebaseIdToken} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 try{assertSameOrigin(request);const user=await verifyFirebaseIdToken(request);await removeDriveGrant(user.uid);return Response.json({connected:false},{headers:{"Cache-Control":"no-store"}})}
 catch(error){return jsonError(error)}
}
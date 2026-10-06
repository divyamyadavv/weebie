import {assertSameOrigin,getAdminServices,jsonError,verifyFirebaseIdToken} from "../../../../../lib/serverFirebase";
import {getRoomEntryDecision} from "../../../../../lib/roomAccess.cjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request,{params}){
 try{
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request),{db}=getAdminServices();
  const decision=await getRoomEntryDecision(db,String(params.code||"").toUpperCase(),user.uid);
  if(!decision.allowed)return Response.json({error:decision.message,code:decision.code},{status:decision.code==="ROOM_NOT_FOUND"?404:403,headers:{"Cache-Control":"no-store"}});
  return Response.json({allowed:true},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}

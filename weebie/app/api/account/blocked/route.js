import {getAdminServices,jsonError,verifySession} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request){
 try{
  const user=await verifySession(request);
  const {db,auth}=getAdminServices();
  const snapshot=await db.collection(`users/${user.uid}/blocks`).get();
  const uids=snapshot.docs.map(item=>item.id).slice(0,100);
  const found=new Map();
  if(uids.length){
   const result=await auth.getUsers(uids.map(uid=>({uid})));
   for(const record of result.users)found.set(record.uid,record);
  }
  const blocked=uids.map(uid=>({uid,name:found.get(uid)?.displayName||found.get(uid)?.email?.split("@")[0]||"Deleted account",photoURL:found.get(uid)?.photoURL||null}));
  return Response.json({blocked},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}

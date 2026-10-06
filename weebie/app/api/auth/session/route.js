import {clearSessionCookie,issueSessionCookie,jsonError} from "../../../../lib/serverFirebase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request){
 try{return await issueSessionCookie(request)}catch(error){return jsonError(error)}
}

export async function DELETE(){return clearSessionCookie()}
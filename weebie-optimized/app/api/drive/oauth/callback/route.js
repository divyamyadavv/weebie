import {NextResponse} from "next/server";
import {equalState,exchangeAuthorizationCode,openOAuthState,saveDriveGrant} from "../../../../../lib/driveServer";
import {HttpError} from "../../../../../lib/serverFirebase";
import {normalizeGoogleOAuthError} from "../../../../../lib/driveOAuthErrors.cjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function readStateCookie(request){
 const item=(request.headers.get("cookie")||"").split(";").map(value=>value.trim()).find(value=>value.startsWith("weebie_drive_oauth="));
 return item?decodeURIComponent(item.slice("weebie_drive_oauth=".length)):null;
}

function clearStateCookie(response){
 const secure=process.env.NODE_ENV==="production"?"; Secure":"";
 response.headers.append("Set-Cookie",`weebie_drive_oauth=; Path=/api/drive/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
 response.headers.set("Cache-Control","no-store");
 return response;
}

export async function GET(request){
 const url=new URL(request.url),origin=url.origin;
 let returnTo="/dashboard",result="error",errorCode="internal_error",stage="read_state";
 try{
  const sealed=readStateCookie(request);
  if(!sealed)throw new HttpError(400,"Google authorization state is missing.");
  let state;
  try{state=openOAuthState(sealed)}catch{errorCode="state_invalid";throw new HttpError(400,"Google authorization state is invalid or expired.")}
  const expected=url.searchParams.get("state")||"";
  if(Date.now()-state.createdAt>10*60*1000||!equalState(state.state,expected)){errorCode="state_invalid";throw new HttpError(400,"Google authorization state is invalid or expired.")}
  returnTo=state.returnTo;
  stage="google_authorization";
  const googleError=url.searchParams.get("error");
  if(googleError){errorCode=normalizeGoogleOAuthError(googleError);throw new HttpError(400,"Google Drive authorization was denied.")}
  const code=url.searchParams.get("code");
  if(!code){errorCode="state_invalid";throw new HttpError(400,"Google did not return an authorization code.")}
  stage="token_exchange";
  const refreshToken=await exchangeAuthorizationCode(code);
  stage="save_grant";
  try{await saveDriveGrant(state.uid,refreshToken)}catch{errorCode="grant_storage_failed";throw new HttpError(503,"Google authorization completed, but Weebie could not securely save the Drive connection.")}
  result="connected";
 }catch(error){
  if(error.driveOAuthCode)errorCode=error.driveOAuthCode;
  else if(error instanceof HttpError&&error.status===503)errorCode="setup";
  else if(errorCode==="internal_error"&&stage==="read_state")errorCode="state_missing";
  console.error("[drive-oauth] callback failed",{stage,code:errorCode});
  result=errorCode==="setup"?"setup":"error";
 }
 const redirect=new URL(returnTo,origin);
 redirect.searchParams.set("drive",result);
 if(result==="error")redirect.searchParams.set("driveError",errorCode);
 return clearStateCookie(NextResponse.redirect(redirect));
}
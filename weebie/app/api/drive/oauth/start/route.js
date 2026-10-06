import {randomBytes} from "node:crypto";
import {assertSameOrigin,HttpError,jsonError,verifyFirebaseIdToken} from "../../../../../lib/serverFirebase";
import {DRIVE_SCOPE,sealOAuthState,serverDriveConfig} from "../../../../../lib/driveServer";
import {driveRedirectMatchesApp} from "../../../../../lib/driveOAuthErrors.cjs";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function safeReturnTo(value,origin){
 if(typeof value!=="string"||!value.startsWith("/")||value.startsWith("//")||value.includes("\\"))return "/dashboard";
 try{const url=new URL(value,origin);if(url.origin!==origin)return "/dashboard";if(url.pathname!=="/dashboard"&&!/^\/room\/[A-Z0-9]{6,20}$/.test(url.pathname))return "/dashboard";return `${url.pathname}${url.search}`}catch{return "/dashboard"}
}

export async function POST(request){
 try{
  assertSameOrigin(request);
  const user=await verifyFirebaseIdToken(request),config=serverDriveConfig();
  const origin=new URL(request.url).origin;
  if(!driveRedirectMatchesApp(config.redirectUri,origin))throw new HttpError(503,"GOOGLE_OAUTH_REDIRECT_URI must exactly match this app's /api/drive/oauth/callback URL.");
  let body={};try{body=await request.json()}catch{}
  const state=randomBytes(32).toString("base64url");
  const sealed=sealOAuthState({state,uid:user.uid,returnTo:safeReturnTo(body.returnTo,origin),createdAt:Date.now()});
  const authorizationUrl=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id",config.clientId);
  authorizationUrl.searchParams.set("redirect_uri",config.redirectUri);
  authorizationUrl.searchParams.set("response_type","code");
  authorizationUrl.searchParams.set("scope",DRIVE_SCOPE);
  authorizationUrl.searchParams.set("access_type","offline");
  authorizationUrl.searchParams.set("prompt","consent");
  authorizationUrl.searchParams.set("state",state);
  const secure=process.env.NODE_ENV==="production"?"; Secure":"";
  return Response.json({authorizationUrl:authorizationUrl.href},{headers:{"Set-Cookie":`weebie_drive_oauth=${encodeURIComponent(sealed)}; Path=/api/drive/oauth/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,"Cache-Control":"no-store"}});
 }catch(error){return jsonError(error)}
}
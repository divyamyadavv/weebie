import "server-only";
import {applicationDefault,cert,getApps,initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {assertSameOrigin as validateSameOrigin} from "./requestOrigin.cjs";

const SESSION_COOKIE="weebie_session";
const SESSION_AGE=5*24*60*60*1000;
let services;

export class HttpError extends Error{
 constructor(status,message){super(message);this.status=status}
}

export function getAdminServices(){
 if(services)return services;
 const usingEmulators=process.env.NODE_ENV==="development"&&process.env.NEXT_PUBLIC_FIREBASE_EMULATORS==="true";
 const clientProjectId=usingEmulators?(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_PROJECT_ID||"demo-weebie-local"):process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
 const configuredProjectId=process.env.FIREBASE_ADMIN_PROJECT_ID;
 if(clientProjectId&&configuredProjectId&&clientProjectId!==configuredProjectId)throw new HttpError(503,"Firebase server authentication project does not match the client project.");
 const projectId=configuredProjectId||clientProjectId;
 if(!projectId)throw new HttpError(503,"Firebase server authentication is not configured.");
 let credential;
 try{
  const serialized=process.env.FIREBASE_ADMIN_CREDENTIALS_JSON;
  credential=serialized?cert(JSON.parse(serialized)):applicationDefault();
 }catch{throw new HttpError(503,"Firebase server credentials are invalid.")}
 const existing=getApps().find(item=>item.name==="weebie-server");
 if(existing&&existing.options.projectId!==projectId)throw new HttpError(503,"Firebase server authentication project does not match the configured project.");
 const app=existing||initializeApp({credential,projectId},"weebie-server");
 services={auth:getAuth(app),db:getFirestore(app)};
 return services;
}

function sessionCookie(request){
 const cookie=request.headers.get("cookie")||"";
 const value=cookie.split(";").map(item=>item.trim()).find(item=>item.startsWith(`${SESSION_COOKIE}=`));
 return value?decodeURIComponent(value.slice(SESSION_COOKIE.length+1)):null;
}

function assertSignedIn(decoded){
 const provider=decoded.firebase?.sign_in_provider;
 if(decoded.email_verified!==true&&provider!=="google.com")throw new HttpError(403,"Verify your Weebie email before using room video.");
 return decoded;
}

export async function verifySession(request){
 const cookie=sessionCookie(request);
 if(!cookie)throw new HttpError(401,"Sign in to Weebie to watch this room video.");
 try{return assertSignedIn(await getAdminServices().auth.verifySessionCookie(cookie,true))}
 catch(error){if(error instanceof HttpError)throw error;throw new HttpError(401,"Your Weebie session expired. Sign in again.")}
}

export async function verifyFirebaseIdToken(request){
 const authorization=request.headers.get("authorization")||"";
 if(!authorization.startsWith("Bearer "))throw new HttpError(401,"Sign in to Weebie first.");
 try{return assertSignedIn(await getAdminServices().auth.verifyIdToken(authorization.slice(7),true))}
 catch(error){
  if(error instanceof HttpError)throw error;
  console.error("[auth] Firebase ID token verification failed",error?.code||"unknown");
  throw new HttpError(401,"Your Weebie sign-in expired. Sign in again.");
 }
}

export async function issueSessionCookie(request){
 const decoded=await verifyFirebaseIdToken(request);
 const {auth}=getAdminServices();
 const value=await auth.createSessionCookie(request.headers.get("authorization").slice(7),{expiresIn:SESSION_AGE});
 const secure=process.env.NODE_ENV==="production"?"; Secure":"";
 return new Response(null,{status:204,headers:{"Set-Cookie":`${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_AGE/1000}${secure}`,"Cache-Control":"no-store"}});
}

export function clearSessionCookie(){
 const secure=process.env.NODE_ENV==="production"?"; Secure":"";
 return new Response(null,{status:204,headers:{"Set-Cookie":`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,"Cache-Control":"no-store"}});
}

export async function getRoomForMember(db,code,uid,{adminOnly=false}={}){
 if(!/^[A-Z0-9]{6,20}$/.test(code))throw new HttpError(404,"Room not found.");
 const roomRef=db.doc(`rooms/${code}`),memberRef=db.doc(`rooms/${code}/members/${uid}`);
 const [roomSnapshot,memberSnapshot]=await Promise.all([roomRef.get(),memberRef.get()]);
 if(!roomSnapshot.exists)throw new HttpError(404,"Room not found.");
 if(!memberSnapshot.exists||memberSnapshot.data().kicked===true||memberSnapshot.data().blocked===true)throw new HttpError(403,"You are not an active member of this room.");
 const room=roomSnapshot.data();
 if(adminOnly&&(room.adminId||room.hostId)!==uid)throw new HttpError(403,"Only this room's host can change its Drive video.");
 return {room,roomRef,member:memberSnapshot.data()};
}

export function jsonError(error){
 const status=error instanceof HttpError?error.status:500;
 const message=status===500?"The server could not complete the request.":error.message;
 return Response.json({error:message},{status,headers:{"Cache-Control":"no-store"}});
}

export function assertSameOrigin(request){
 try{validateSameOrigin(request)}
 catch(error){throw new HttpError(403,error.message)}
}
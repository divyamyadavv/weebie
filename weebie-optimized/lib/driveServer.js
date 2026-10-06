import "server-only";
import {createCipheriv,createDecipheriv,randomBytes,timingSafeEqual} from "node:crypto";
import {getAdminServices,HttpError} from "./serverFirebase";
import {isDriveVideoMime,normalizeDriveVideoMime} from "./driveVideoMime.cjs";
import {normalizeGoogleOAuthError,normalizeDriveRefreshError,driveOAuthErrorMessage} from "./driveOAuthErrors.cjs";

export const DRIVE_SCOPE="https://www.googleapis.com/auth/drive.readonly";
const AUTH_COLLECTION="driveAuthorizations";
const accessTokens=new Map();
const streamMetadataCache=new Map();
const STREAM_METADATA_TTL=30_000;

export function serverDriveConfig(){
 const missing=[];
 if(!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)missing.push("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
 if(!process.env.GOOGLE_CLIENT_SECRET)missing.push("GOOGLE_CLIENT_SECRET");
 if(!process.env.GOOGLE_OAUTH_REDIRECT_URI)missing.push("GOOGLE_OAUTH_REDIRECT_URI");
 if(!process.env.DRIVE_TOKEN_ENCRYPTION_KEY)missing.push("DRIVE_TOKEN_ENCRYPTION_KEY");
 if(missing.length)throw new HttpError(503,`Google Drive server setup is incomplete: ${missing.join(", ")}.`);
 return {clientId:process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,redirectUri:process.env.GOOGLE_OAUTH_REDIRECT_URI};
}

function encryptionKey(){
 const config=serverDriveConfig();
 void config;
 const key=Buffer.from(process.env.DRIVE_TOKEN_ENCRYPTION_KEY,"base64");
 if(key.length!==32)throw new HttpError(503,"DRIVE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
 return key;
}

export function encryptSecret(value){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
 const ciphertext=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
 return {ciphertext:ciphertext.toString("base64"),iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}

export function decryptSecret(record){
 try{
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(record.iv,"base64"));
  decipher.setAuthTag(Buffer.from(record.tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(record.ciphertext,"base64")),decipher.final()]).toString("utf8");
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,"Stored Drive authorization could not be decrypted. Reconnect Drive.")}
}

export function sealOAuthState(value){
 const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",encryptionKey(),iv);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function openOAuthState(value){
 try{
  const [iv,tag,ciphertext]=value.split(".");
  if(!iv||!tag||!ciphertext)throw new Error("invalid state");
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64url"));
  decipher.setAuthTag(Buffer.from(tag,"base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext,"base64url")),decipher.final()]).toString("utf8"));
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(400,"Google authorization state is invalid or expired.")}
}

function equalState(left,right){
 const a=Buffer.from(String(left)),b=Buffer.from(String(right));
 return a.length===b.length&&timingSafeEqual(a,b);
}

export {equalState};

function authRecord(uid){return getAdminServices().db.doc(`${AUTH_COLLECTION}/${uid}`)}

export async function hasDriveGrant(uid){return (await authRecord(uid).get()).exists}

export async function saveDriveGrant(uid,refreshToken){
 const encrypted=encryptSecret(refreshToken);
 await authRecord(uid).set({ownerUid:uid,...encrypted,scopes:[DRIVE_SCOPE],updatedAt:new Date()});
}

export async function removeDriveGrant(uid){accessTokens.delete(uid);await authRecord(uid).delete()}

async function loadRefreshToken(uid){
 const snapshot=await authRecord(uid).get();
 if(!snapshot.exists)throw new HttpError(409,"The room host must connect Google Drive first.");
 const grant=snapshot.data();
 if(!grant||grant.ownerUid!==uid){
  console.error("[drive-oauth] stored grant rejected",{code:"owner_mismatch"});
  throw new HttpError(403,"Stored Drive authorization does not belong to this Weebie account.");
 }
 return decryptSecret(grant);
}

export async function getDriveAccessToken(uid){
 const config=serverDriveConfig(),refreshToken=await loadRefreshToken(uid);
 const cached=accessTokens.get(uid);
 if(cached&&cached.expiresAt>Date.now()+30000)return cached.value;
 let response;
 try{response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"}),cache:"no-store"})}
 catch{console.error("[drive-oauth] token refresh failed",{code:"token_exchange_failed",status:null});throw new HttpError(502,driveOAuthErrorMessage("token_exchange_failed"))}
 let data;
 try{data=await response.json()}catch{data=null}
 if(!response.ok){
  const code=normalizeDriveRefreshError(data?.error,response.status);
  console.error("[drive-oauth] token refresh failed",{code,status:response.status});
  if(code==="invalid_grant"){await removeDriveGrant(uid);throw new HttpError(409,"The host's Google Drive authorization expired or was revoked. The host must reconnect Drive.")}
  throw new HttpError(502,driveOAuthErrorMessage(code));
 }
 if(typeof data?.access_token!=="string"||!data.access_token){
  console.error("[drive-oauth] token refresh failed",{code:"token_response_invalid",status:response.status});
  throw new HttpError(502,driveOAuthErrorMessage("token_response_invalid"));
 }
 accessTokens.set(uid,{value:data.access_token,expiresAt:Date.now()+Math.min(Number(data.expires_in)||3600,300)*1000});
 return data.access_token;
}

function supportedMime(metadata){
 const mime=normalizeDriveVideoMime(metadata.mimeType);
 if(!isDriveVideoMime(mime))throw new HttpError(415,"This Drive file is not a supported video.");
 if(metadata.capabilities?.canDownload===false)throw new HttpError(403,"The Drive owner has disabled downloads for this video.");
 return mime;
}

async function driveMetadata(token,fileId){
 const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
 url.searchParams.set("supportsAllDrives","true");
 url.searchParams.set("fields","id,name,mimeType,size,videoMediaMetadata(width,height,durationMillis),capabilities(canDownload)");
 const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
 if(response.status===401)throw new HttpError(401,"Google Drive's short-lived access token expired.");
 if(response.status===403)throw new HttpError(403,"Google Drive denied access or download permission for this file.");
 if(response.status===404)throw new HttpError(404,"The selected Drive video is missing or unavailable.");
 if(!response.ok)throw new HttpError(502,"Google Drive could not read the selected file metadata.");
 const metadata=await response.json();
 if(metadata.id!==fileId)throw new HttpError(404,"The selected Drive file does not match this room.");
 return {...metadata,mime:supportedMime(metadata),size:Number(metadata.size)||0};
}

export async function selectDriveVideo(uid,fileId){
 if(typeof fileId!=="string"||!/^[-_a-zA-Z0-9]{10,200}$/.test(fileId))throw new HttpError(400,"Select a valid Google Drive file.");
 const {metadata}=await getFileMetadataWithRefresh(uid,fileId);
 return {fileId:metadata.id,name:String(metadata.name||"Drive video").slice(0,200),mime:metadata.mime,size:metadata.size,width:Number(metadata.videoMediaMetadata?.width)||0,height:Number(metadata.videoMediaMetadata?.height)||0,durationMillis:Number(metadata.videoMediaMetadata?.durationMillis)||0,qualityStatus:"none",qualities:[],quality:"original"};
}

async function getFileMetadataWithRefresh(uid,fileId){
 let token=await getDriveAccessToken(uid);
 try{return {token,metadata:await driveMetadata(token,fileId)}}
 catch(error){if(error.status!==401)throw error;accessTokens.delete(uid);token=await getDriveAccessToken(uid);return {token,metadata:await driveMetadata(token,fileId)}}
}

function cacheStreamMetadata(uid,fileId,metadata){
 const key=`${uid}:${fileId}`;
 if(streamMetadataCache.size>=500&&!streamMetadataCache.has(key))streamMetadataCache.delete(streamMetadataCache.keys().next().value);
 streamMetadataCache.set(key,{metadata,expiresAt:Date.now()+STREAM_METADATA_TTL});
}

export async function listDriveVideos(uid,pageToken){
 let token=await getDriveAccessToken(uid);
 const url=new URL("https://www.googleapis.com/drive/v3/files");
 url.searchParams.set("q","trashed = false and mimeType contains 'video/'");
 url.searchParams.set("pageSize","100");
 url.searchParams.set("orderBy","name");
 url.searchParams.set("supportsAllDrives","true");
 url.searchParams.set("includeItemsFromAllDrives","true");
 url.searchParams.set("fields","nextPageToken,files(id,name,mimeType,size,videoMediaMetadata(width,height,durationMillis),capabilities(canDownload))");
 if(pageToken)url.searchParams.set("pageToken",pageToken);
 const send=()=>fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:"no-store"});
 let response=await send();
 if(response.status===401){accessTokens.delete(uid);token=await getDriveAccessToken(uid);response=await send()}
 if(response.status===401)throw new HttpError(401,"Google Drive's short-lived access token expired.");
 if(response.status===403)throw new HttpError(403,"Google Drive denied access to the host's video list.");
 if(!response.ok)throw new HttpError(502,"Google Drive could not list videos.");
 const data=await response.json();
 return {files:(data.files||[]).filter(file=>file.capabilities?.canDownload!==false&&isDriveVideoMime(file.mimeType)).map(file=>({id:file.id,name:String(file.name||"Drive video").slice(0,200),mime:normalizeDriveVideoMime(file.mimeType),size:Number(file.size)||0,width:Number(file.videoMediaMetadata?.width)||0,height:Number(file.videoMediaMetadata?.height)||0,durationMillis:Number(file.videoMediaMetadata?.durationMillis)||0})),nextPageToken:data.nextPageToken||null};
}

export async function exchangeAuthorizationCode(code){
 const config=serverDriveConfig();
 let response;
 try{response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:"authorization_code"}),cache:"no-store"})}
 catch{const error=new HttpError(502,driveOAuthErrorMessage("token_exchange_failed"));error.driveOAuthCode="token_exchange_failed";throw error}
 let data;
 try{data=await response.json()}catch{const error=new HttpError(502,driveOAuthErrorMessage("token_response_invalid"));error.driveOAuthCode="token_response_invalid";throw error}
 if(!response.ok){const oauthCode=normalizeGoogleOAuthError(data.error);const error=new HttpError(502,driveOAuthErrorMessage(oauthCode));error.driveOAuthCode=oauthCode;throw error}
 if(!data.refresh_token||!data.access_token){const error=new HttpError(502,driveOAuthErrorMessage("token_response_invalid"));error.driveOAuthCode="token_response_invalid";throw error}
 if(!String(data.scope||"").split(" ").includes(DRIVE_SCOPE)){const error=new HttpError(502,driveOAuthErrorMessage("missing_scope"));error.driveOAuthCode="missing_scope";throw error}
 return data.refresh_token;
}

export async function streamDriveFile(uid,fileId,range){
 const cacheKey=`${uid}:${fileId}`,cached=streamMetadataCache.get(cacheKey);
 let token,metadata;
 if(cached&&cached.expiresAt>Date.now()){
  token=await getDriveAccessToken(uid);metadata=cached.metadata;
 }else{
  const result=await getFileMetadataWithRefresh(uid,fileId);token=result.token;metadata=result.metadata;
  cacheStreamMetadata(uid,fileId,metadata);
 }
 const url=new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
 url.searchParams.set("alt","media");url.searchParams.set("supportsAllDrives","true");
 const mediaFetch=()=>{const headers={Authorization:`Bearer ${token}`};if(range)headers.Range=range;return fetch(url,{headers,cache:"no-store",redirect:"follow"})};
 let response=await mediaFetch();
 if(response.status===401){await response.body?.cancel();accessTokens.delete(uid);token=await getDriveAccessToken(uid);metadata=await driveMetadata(token,fileId);cacheStreamMetadata(uid,fileId,metadata);response=await mediaFetch()}
 if(response.status===401)throw new HttpError(401,"Google Drive's short-lived access token expired.");
 if(response.status===403)throw new HttpError(403,"Google Drive denied access or download permission for this video.");
 if(response.status===404)throw new HttpError(404,"The selected Drive video is missing or unavailable.");
 if(range&&response.status===416)return {response,mime:metadata.mime,size:metadata.size};
 if(range&&response.status!==206){await response.body?.cancel();throw new HttpError(502,"Google Drive did not honor the video byte-range request.");}
 if(!range&&response.status!==200){await response.body?.cancel();throw new HttpError(502,"Google Drive did not return video media.");}
 const contentType=String(response.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(contentType&&!isDriveVideoMime(contentType)&&contentType!=="application/octet-stream"){await response.body?.cancel();throw new HttpError(502,"Google Drive returned a non-video response instead of the selected media.");}
 if(!response.body)throw new HttpError(502,"Google Drive returned an empty video response.");
 return {response,mime:contentType==="application/octet-stream"||!contentType?metadata.mime:contentType,size:metadata.size};
}
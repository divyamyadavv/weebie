import {fetchWithFirebaseAuth} from "./authenticatedFetch";

export class DriveApiError extends Error{
 constructor(message,status){super(message);this.status=status}
}

async function api(path,options={}){
 const headers=new Headers(options.headers);
 if(options.body&&!headers.has("Content-Type"))headers.set("Content-Type","application/json");
 const response=await fetchWithFirebaseAuth(path,{...options,headers});
 const data=response.status===204?{}:await response.json().catch(()=>({}));
 if(!response.ok)throw new DriveApiError(data.error||"Google Drive request failed.",response.status);
 return data;
}

export function getDriveStatus(){return api("/api/drive/status")}

export function connectDrive(returnTo){
 return api("/api/drive/oauth/start",{method:"POST",body:JSON.stringify({returnTo})});
}

export function listDriveVideos(pageToken){
 const query=pageToken?`?pageToken=${encodeURIComponent(pageToken)}`:"";
 return api(`/api/drive/files${query}`);
}

export function selectDriveVideo(fileId,roomCode){
 return api("/api/drive/select",{method:"POST",body:JSON.stringify({fileId,...(roomCode?{roomCode}:{})})});
}

export function disconnectDrive(){return api("/api/drive/disconnect",{method:"POST"})}
const messages={
 setup:"Google Drive server setup is incomplete. Check the Drive OAuth and token-encryption environment variables.",
 state_missing:"Google Drive authorization state is missing. Start the connection again from Weebie.",
 state_invalid:"Google Drive authorization state is invalid or expired. Start the connection again.",
 access_denied:"Google Drive access was cancelled or denied. Approve the requested read-only Drive access to connect.",
 invalid_client:"Google rejected the Drive OAuth client credentials. In Google Cloud Console, verify that the server-side Drive client secret matches the configured Drive OAuth client ID.",
 unauthorized_client:"Google rejected the configured Drive OAuth client for this token request. Verify the server-side Drive OAuth client configuration.",
 redirect_uri_mismatch:"Google rejected the Drive callback URL. Register the exact GOOGLE_OAUTH_REDIRECT_URI value as an authorized redirect URI for the configured Drive OAuth client.",
 invalid_grant:"Google rejected the authorization code. It may have expired or already been used; start the Drive connection again.",
 invalid_scope:"Google did not accept the requested Drive read-only scope. Check the OAuth consent-screen configuration.",
 missing_scope:"Google did not grant the required read-only Drive access. Reconnect and approve the requested access.",
 temporary_failure:"Google Drive could not refresh authorization right now. Retry shortly; if the problem persists, check server-to-Google connectivity.",
 provider_error:"Google rejected the Drive refresh request. Reconnect Drive and inspect the sanitized server log category if the problem continues.",
 token_response_invalid:"Google returned an incomplete Drive authorization response. Try connecting again.",
 token_exchange_failed:"We could not contact Google to complete Drive authorization. Check the server connection and try again.",
 grant_storage_failed:"Google authorization completed, but Weebie could not securely save the Drive connection. Check Firebase Admin access and try again.",
 internal_error:"Google Drive authorization could not be completed. Try again."
};
const knownCodes=new Set(Object.keys(messages));

function normalizeGoogleOAuthError(value){
 const code=typeof value==="string"?value.toLowerCase().replace(/[^a-z0-9_-]/g,""):"";
 if(code==="invalidclient")return "invalid_client";
 if(code==="invalidgrant")return "invalid_grant";
 if(code==="invalidscope")return "invalid_scope";
 if(code==="unauthorized_client"||code==="unauthorizedclient")return "unauthorized_client";
 if(code==="redirecturi_mismatch"||code==="redirect_uri_mismatch")return "redirect_uri_mismatch";
 return knownCodes.has(code)?code:"internal_error";
}

function normalizeDriveRefreshError(value,status){
 const code=normalizeGoogleOAuthError(value);
 if(code!=="internal_error")return code;
 if(value==="temporarily_unavailable"||value==="server_error")return "temporary_failure";
 if(status===429||(Number.isInteger(status)&&status>=500))return "temporary_failure";
 return "provider_error";
}

function driveOAuthErrorMessage(code){
 return messages[knownCodes.has(code)?code:"internal_error"];
}

function driveRedirectMatchesApp(redirectUri,appUrl){
 try{
  const redirect=new URL(redirectUri),app=new URL(appUrl);
  return redirect.href===new URL("/api/drive/oauth/callback",app).href;
 }catch{return false}
}

module.exports={normalizeGoogleOAuthError,normalizeDriveRefreshError,driveOAuthErrorMessage,driveRedirectMatchesApp};

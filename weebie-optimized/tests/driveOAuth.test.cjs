const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeGoogleOAuthError,normalizeDriveRefreshError,driveOAuthErrorMessage,driveRedirectMatchesApp}=require("../lib/driveOAuthErrors.cjs");

test("Google token errors are reduced to safe OAuth categories",()=>{
 assert.equal(normalizeGoogleOAuthError("invalid_client"),"invalid_client");
 assert.equal(normalizeGoogleOAuthError("redirect_uri_mismatch"),"redirect_uri_mismatch");
 assert.equal(normalizeGoogleOAuthError("access_denied"),"access_denied");
 assert.equal(normalizeGoogleOAuthError("unknown-secret-bearing-description"),"internal_error");
});

test("Drive refresh failures are classified without preserving provider descriptions",()=>{
 assert.equal(normalizeDriveRefreshError("invalid_grant",400),"invalid_grant");
 assert.equal(normalizeDriveRefreshError("invalid_client",401),"invalid_client");
 assert.equal(normalizeDriveRefreshError("unauthorized_client",400),"unauthorized_client");
 assert.equal(normalizeDriveRefreshError("temporarily_unavailable",503),"temporary_failure");
 assert.equal(normalizeDriveRefreshError("server_error",400),"temporary_failure");
 assert.equal(normalizeDriveRefreshError("secret-bearing provider description",429),"temporary_failure");
 assert.equal(normalizeDriveRefreshError("secret-bearing provider description",400),"provider_error");
 for(const code of ["invalid_grant","invalid_client","unauthorized_client","temporary_failure","provider_error"]){
  assert.doesNotMatch(driveOAuthErrorMessage(code),/secret-bearing|access token|refresh token/i);
 }
});

test("OAuth error messages explain client and redirect configuration without echoing provider details",()=>{
 assert.match(driveOAuthErrorMessage("invalid_client"),/Drive OAuth client credentials/);
 assert.match(driveOAuthErrorMessage("invalid_client"),/server-side Drive client secret/);
 assert.match(driveOAuthErrorMessage("redirect_uri_mismatch"),/GOOGLE_OAUTH_REDIRECT_URI/);
 assert.doesNotMatch(driveOAuthErrorMessage("invalid_client"),/secret value|access token/i);
 assert.equal(driveOAuthErrorMessage("unrecognized"),driveOAuthErrorMessage("internal_error"));
});

test("Drive OAuth callback must match the app origin and exact callback path",()=>{
 assert.equal(driveRedirectMatchesApp("http://localhost:3000/api/drive/oauth/callback","http://localhost:3000"),true);
 assert.equal(driveRedirectMatchesApp("http://localhost:3001/api/drive/oauth/callback","http://localhost:3000"),false);
 assert.equal(driveRedirectMatchesApp("http://localhost:3000/other/callback","http://localhost:3000"),false);
 assert.equal(driveRedirectMatchesApp("not a URI","http://localhost:3000"),false);
});

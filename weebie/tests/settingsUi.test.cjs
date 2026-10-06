const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {describeProviders,hasPasswordProvider,deleteConfirmationReady,friendlyAuthError}=require("../lib/settingsUi.cjs");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");

test("sign-in methods are listed once with readable names",()=>{
 const list=describeProviders([{providerId:"google.com"},{providerId:"password"},{providerId:"google.com"},{providerId:"github.com"},null,{}]);
 assert.deepEqual(list,[{id:"google.com",label:"Google"},{id:"password",label:"Email & password"},{id:"github.com",label:"github.com"}]);
 assert.deepEqual(describeProviders(undefined),[]);
 assert.equal(hasPasswordProvider([{providerId:"password"}]),true);
 assert.equal(hasPasswordProvider([{providerId:"google.com"}]),false);
});

test("the delete button needs the word DELETE, plus the password for password accounts",()=>{
 assert.equal(deleteConfirmationReady({text:"DELETE",needsPassword:false,password:""}),true);
 assert.equal(deleteConfirmationReady({text:" DELETE ",needsPassword:false}),true);
 assert.equal(deleteConfirmationReady({text:"delete",needsPassword:false}),false);
 assert.equal(deleteConfirmationReady({text:"",needsPassword:false}),false);
 assert.equal(deleteConfirmationReady({text:"DELETE",needsPassword:true,password:""}),false);
 assert.equal(deleteConfirmationReady({text:"DELETE",needsPassword:true,password:"secret"}),true);
});

test("Firebase auth errors become short readable messages",()=>{
 assert.equal(friendlyAuthError({code:"auth/wrong-password"}),"That password is not correct.");
 assert.equal(friendlyAuthError({code:"auth/invalid-credential"}),"That password is not correct.");
 assert.match(friendlyAuthError({code:"auth/popup-closed-by-user"}),/window was closed/);
 assert.match(friendlyAuthError({code:"auth/popup-blocked"}),/pop-ups/);
 assert.equal(friendlyAuthError({message:"Firebase: Something odd (auth/odd-thing)."}),"Something odd");
 assert.match(friendlyAuthError(null),/went wrong/);
});

test("Settings shows the real profile photo and the real sign-in methods",()=>{
 const page=read("app/settings/page.js");
 assert.match(page,/<Avatar name=\{name\|\|"A"\} photoURL=\{user\?\.photoURL\}/);
 assert.match(page,/describeProviders\(user\?\.providerData\)/);
 assert.doesNotMatch(page,/Sign in with Google from your account screen/);
});

test("Settings rows are real: switches save preferences, and no dead chevron rows remain",()=>{
 const page=read("app/settings/page.js");
 assert.match(page,/role="switch"/);
 for(const key of ["friendRequestPopups","roomInvitePopups","pauseAllPopups","appearOffline"])assert.match(page,new RegExp(key));
 assert.match(page,/updatePreferences\(\{friendRequestPopups:value\}\)/);
 assert.doesNotMatch(page,/<Row I=/);
});

test("Appear offline really stops publishing presence and turning it off restarts it",()=>{
 const page=read("app/settings/page.js"),presence=read("lib/presence.js");
 assert.match(page,/if\(value\)await stopPresenceTracking\(\);else if\(user\)await startPresenceTracking\(user/);
 assert.match(presence,/isAppearOffline\(window\.localStorage,user\?\.uid\)\)return async\(\)=>\{\}/);
 assert.match(presence,/if\(stopActivePresence\)return stopActivePresence;/);
});

test("both pop-up components honour the notification preferences",()=>{
 for(const [file,kind] of [["components/FriendRequests.js","friendRequest"],["components/RoomInvitations.js","roomInvite"]]){
  const source=read(file);
  assert.match(source,new RegExp(`popupsAllowed\\(preferences,"${kind}"\\)`),file);
  assert.match(source,/!popupEnabled\)return/,`${file} must not claim a pop-up while disabled`);
  assert.match(source,/\[incoming,popupEnabled\]|\[trustedInvites,popupEnabled\]/,file);
 }
});

test("account deletion is protected: same origin, verified token, recent sign-in, typed confirmation",()=>{
 const route=read("app/api/account/delete/route.js");
 const order=["assertSameOrigin(request)","verifyFirebaseIdToken(request)","isRecentSignIn(decoded)","body?.confirmation!==\"DELETE\"","deleteAccountData("];
 let last=-1;
 for(const needle of order){const index=route.indexOf(needle);assert.ok(index>last,`${needle} must come after the previous check`);last=index}
 assert.match(route,/uid:decoded\.uid/);
 assert.doesNotMatch(route,/body\??\.uid|body\??\.userId/,"the account to delete comes only from the verified token");
});

test("the delete flow re-authenticates before calling the server, and signs out afterwards",()=>{
 const page=read("app/settings/page.js"),auth=read("lib/auth.js");
 assert.match(page,/await reauthenticate\(\{password:del\.password\}\);await deleteAccount\(\)/);
 assert.match(auth,/getIdToken\(true\)/);
 assert.match(auth,/\/api\/account\/delete/);
 assert.match(auth,/await stopPresenceTracking\(\);\s*try\{await A\.signOut\(auth\)\}/);
});

test("the Google button shows the Google logo",()=>{
 const form=read("components/AuthForm.js");
 assert.match(form,/<svg aria-hidden="true" viewBox="0 0 48 48"/);
 for(const color of ["#EA4335","#4285F4","#FBBC05","#34A853"])assert.match(form,new RegExp(color));
 assert.match(form,/with Google<\/span><\/button>/);
});

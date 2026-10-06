// Small pure helpers for the Settings page (kept separate so they are unit-tested).
const PROVIDER_LABELS={"google.com":"Google",password:"Email & password"};

function describeProviders(providerData){
 const seen=new Set(),result=[];
 for(const item of Array.isArray(providerData)?providerData:[]){
  const id=item?.providerId;
  if(!id||seen.has(id))continue;
  seen.add(id);result.push({id,label:PROVIDER_LABELS[id]||id});
 }
 return result;
}

function hasPasswordProvider(providerData){return describeProviders(providerData).some(item=>item.id==="password")}

// The delete button unlocks only when the user typed DELETE and, for password accounts, entered the password.
function deleteConfirmationReady({text,needsPassword,password}){
 if(String(text||"").trim()!=="DELETE")return false;
 return !needsPassword||String(password||"").length>0;
}

function friendlyAuthError(error){
 const code=error?.code||"",message=String(error?.message||"");
 if(code==="auth/wrong-password"||code==="auth/invalid-credential"||code==="auth/invalid-login-credentials")return "That password is not correct.";
 if(code==="auth/popup-closed-by-user"||code==="auth/cancelled-popup-request")return "The sign-in window was closed. Please try again.";
 if(code==="auth/popup-blocked")return "Your browser blocked the sign-in window. Allow pop-ups and try again.";
 if(code==="auth/too-many-requests")return "Too many attempts. Wait a few minutes and try again.";
 if(code==="auth/requires-recent-login")return "For your security, confirm your sign-in again and retry.";
 return message.replace(/^Firebase: /,"").replace(/\s*\(auth\/[^)]+\)\.?$/,"")||"Something went wrong. Please try again.";
}

module.exports={describeProviders,hasPasswordProvider,deleteConfirmationReady,friendlyAuthError};

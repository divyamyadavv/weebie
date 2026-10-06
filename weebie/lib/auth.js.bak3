import {fbApp} from "./firebase";
import {stopPresenceTracking} from "./presence";
let authReady;
async function getAuth(){const A=await import("firebase/auth"),app=await fbApp(),auth=A.getAuth(app);if(!authReady)authReady=A.setPersistence(auth,A.browserLocalPersistence).then(()=>({A,auth,app})).catch(error=>{authReady=null;throw error});return authReady}
export async function signIn(kind,{email,pw,name}={}){const {A,auth}=await getAuth();let credential;
 if(kind==="google"){const provider=new A.GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});credential=await A.signInWithPopup(auth,provider)}
 else if(kind==="signup"){credential=await A.createUserWithEmailAndPassword(auth,email,pw);if(name)await A.updateProfile(credential.user,{displayName:name})}
 else credential=await A.signInWithEmailAndPassword(auth,email,pw);
 return credential.user}
export async function currentUser(){const {auth}=await getAuth();await auth.authStateReady();return auth.currentUser}
export async function observeAuth(onUser,onError){const {A,auth}=await getAuth();return A.onAuthStateChanged(auth,onUser,onError)}
export function requiresEmailVerification(user){const providers=user?.providerData?.map(item=>item.providerId)||[];return !!user&&!user.emailVerified&&providers.includes("password")&&!providers.includes("google.com")}
export async function sendVerificationEmail(user,continueUrl){const {A,auth}=await getAuth(),target=user||auth.currentUser;if(!target)throw new Error("Sign in again before requesting an email verification link.");return A.sendEmailVerification(target,{url:continueUrl,handleCodeInApp:false})}
export async function applyVerificationCode(code){const {A,auth}=await getAuth();return A.applyActionCode(auth,code)}
export async function reloadCurrentUser(){const {A,auth}=await getAuth();if(!auth.currentUser)return null;await A.reload(auth.currentUser);await auth.currentUser.getIdToken(true);return auth.currentUser}
export async function updateDisplayName(name){const {A,auth}=await getAuth();if(!auth.currentUser)throw new Error("Please sign in again before updating your profile.");await A.updateProfile(auth.currentUser,{displayName:name.trim()});return auth.currentUser}
export async function sendPasswordReset(email){const {A,auth}=await getAuth();return A.sendPasswordResetEmail(auth,email)}
export async function signOutAll(){const {A,auth}=await getAuth();await stopPresenceTracking();await A.signOut(auth);localStorage.removeItem("weebie_user")}

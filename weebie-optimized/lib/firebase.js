const useFirebaseEmulators=process.env.NODE_ENV==="development"&&process.env.NEXT_PUBLIC_FIREBASE_EMULATORS==="true";
const emulatorProjectId=process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_PROJECT_ID||"demo-weebie-local";
const c={apiKey:process.env.NEXT_PUBLIC_FIREBASE_API_KEY,authDomain:process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,databaseURL:process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,projectId:useFirebaseEmulators?emulatorProjectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,storageBucket:process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,messagingSenderId:process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,appId:process.env.NEXT_PUBLIC_FIREBASE_APP_ID,measurementId:process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID};
const emulatorConnections=new WeakMap();
export const isFirebaseAuthReady=!!(c.apiKey&&c.authDomain&&c.projectId&&c.appId);
export const isFirebaseReady=isFirebaseAuthReady&&!!c.databaseURL;
export const isFirestoreReady=isFirebaseAuthReady;
export async function fbApp(){
 if(!isFirebaseAuthReady)throw new Error("Firebase Authentication is not configured. Add NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID and NEXT_PUBLIC_FIREBASE_APP_ID to .env.local.");
 const {initializeApp,getApps}=await import("firebase/app"),existing=getApps().find(app=>app.name==="[DEFAULT]");
 if(existing&&existing.options.projectId!==c.projectId)throw new Error("Firebase client services are connected to a different project than the configured Authentication project.");
 const app=existing||initializeApp(c);
 if(useFirebaseEmulators&&typeof window!=="undefined"){
  let connected=emulatorConnections.get(app);
  if(!connected){
   connected=(async()=>{const [A,F,Fn]=await Promise.all([import("firebase/auth"),import("firebase/firestore"),import("firebase/functions")]),host=process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST||"127.0.0.1";A.connectAuthEmulator(A.getAuth(app),`http://${host}:9099`,{disableWarnings:true});F.connectFirestoreEmulator(F.getFirestore(app),host,8080);Fn.connectFunctionsEmulator(Fn.getFunctions(app),host,5001)})();
   emulatorConnections.set(app,connected);
  }
  await connected;
 }
 return app
}

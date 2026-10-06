"use client";
import {createContext,useCallback,useContext,useEffect,useRef,useState} from "react";
import {observeAuth,requiresEmailVerification,reloadCurrentUser} from "../lib/auth";
import {startPresenceTracking,stopPresenceTracking} from "../lib/presence";
import FriendRequests from "./FriendRequests";
import RoomInvitations from "./RoomInvitations";
import {FriendsProvider} from "../lib/friends";

const AuthContext=createContext({user:null,loading:true,error:null,serverSessionReady:false,serverSessionError:null,presenceError:null});

export function AuthProvider({children}){
 const [user,setUser]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[serverSessionReady,setServerSessionReady]=useState(false),[serverSessionError,setServerSessionError]=useState(null),[presenceError,setPresenceError]=useState(null),sessionRevision=useRef(0);
 useEffect(()=>{
  let active=true,unsubscribe;
  const stopPresence=()=>{void stopPresenceTracking().catch(exception=>{if(active)setPresenceError(exception.message||"Presence could not be updated.")})};
  const syncSession=async(nextUser,revision)=>{
   try{
    let response;
    if(nextUser){const idToken=await nextUser.getIdToken();response=await fetch("/api/auth/session",{method:"POST",credentials:"same-origin",headers:{Authorization:`Bearer ${idToken}`},cache:"no-store"})}
    else response=await fetch("/api/auth/session",{method:"DELETE",credentials:"same-origin",cache:"no-store"});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||"Secure room session is unavailable.")}
    if(active&&sessionRevision.current===revision){setServerSessionError(null);setServerSessionReady(true)}
   }catch(exception){if(active&&sessionRevision.current===revision){setServerSessionError(exception.message||"Secure room session is unavailable.");setServerSessionReady(true)}}
  };
  const beginPresence=(nextUser,revision)=>{
   stopPresence();
   if(!nextUser||requiresEmailVerification(nextUser))return;
   setPresenceError(null);
   void startPresenceTracking(nextUser,exception=>{if(active){console.error("[presence] Firestore session update failed",exception?.code||"unknown");setPresenceError("Presence could not be updated. Friends may appear offline until the connection recovers.")}})
    .then(stop=>{if(!active||sessionRevision.current!==revision)void stop();})
    .catch(exception=>{if(active&&sessionRevision.current===revision){console.error("[presence] Firestore session setup failed",exception?.code||"unknown");setPresenceError("Presence could not be started. Friends may appear offline.")}});
  };
  observeAuth(nextUser=>{if(active){const revision=++sessionRevision.current;setUser(nextUser);setLoading(false);setError(null);setServerSessionError(null);setServerSessionReady(false);if(nextUser)beginPresence(nextUser,revision);else{stopPresence();setPresenceError(null)}void syncSession(nextUser,revision)}},nextError=>{if(active){const revision=++sessionRevision.current;setError(nextError);setUser(null);setLoading(false);setServerSessionReady(false);stopPresence();void syncSession(null,revision)}})
   .then(stop=>{if(active)unsubscribe=stop;else stop()})
   .catch(nextError=>{if(active){setError(nextError);setUser(null);setLoading(false)}});
  return()=>{active=false;unsubscribe?.();stopPresence()};
 },[]);
 const refreshUser=useCallback(async()=>{const nextUser=await reloadCurrentUser();setUser(nextUser);return nextUser},[]);
 const verifiedUser=user&&!requiresEmailVerification(user)?user:null;
 return <AuthContext.Provider value={{user,loading,error,requiresVerification:requiresEmailVerification(user),refreshUser,serverSessionReady,serverSessionError,presenceError}}><FriendsProvider user={verifiedUser}>{children}<FriendRequests/><RoomInvitations/></FriendsProvider>{presenceError&&<p role="status" className="fixed bottom-16 left-4 z-[70] max-w-sm rounded-lg border border-amber-400/20 bg-panel px-3 py-2 text-xs text-amber-200 shadow-xl">{presenceError}</p>}</AuthContext.Provider>;
}

export const useAuth=()=>useContext(AuthContext);
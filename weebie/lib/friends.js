"use client";
import {createContext,useContext,useEffect,useMemo,useState} from "react";
import {fbApp,isFirestoreReady} from "./firebase";
import {currentUser} from "./auth";
import {callFriendApi} from "./friendApiClient";
import friendSubscriptions from "./friendSubscriptions.cjs";
import friendRequestUi from "./friendRequestUi.cjs";
import presenceSessions from "./presenceSessions.cjs";

const FriendsContext=createContext(null);

function useFriendsState(authUser){
 const [uid,setUid]=useState(null),[name,setName]=useState(""),[friends,setFriends]=useState([]),[friendsStatus,setFriendsStatus]=useState("loading"),[incoming,setIncoming]=useState([]),[outgoing,setOutgoing]=useState([]),[error,setError]=useState(""),[friendPresence,setFriendPresence]=useState({});
 const friendIds=useMemo(()=>friends.map(friend=>friend.id).sort().join("|"),[friends]);
 useEffect(()=>{let dead=false,stops=[];(async()=>{try{if(!isFirestoreReady){if(!dead){setFriendsStatus("error");setError("Firebase Authentication and Firestore are not configured.")}return}const user=authUser===undefined?await currentUser():authUser;if(!user){if(!dead){setUid(null);setFriends([]);setIncoming([]);setOutgoing([]);setFriendPresence({});setFriendsStatus("loading")}return}const app=await fbApp(),F=await import("firebase/firestore"),db=F.getFirestore(app);if(dead)return;setUid(user.uid);setName(user.displayName||user.email?.split("@")[0]||"Weebie");setFriends([]);setFriendPresence({});setFriendsStatus("loading");stops=friendSubscriptions.subscribeFriendData(F,db,user.uid,{onIncoming:setIncoming,onOutgoing:setOutgoing,onFriends:rows=>{setFriends(rows);setFriendsStatus("ready");setError("")},onError:(exception,source)=>{if(!dead){const failure=friendSubscriptions.friendListenerFailure(exception,source);console.error("[friends] Firestore listener failed",failure.diagnostic);if(source.listener==="Accepted friendships")setFriendsStatus("error");setError(failure.message)}}})}catch(exception){if(!dead){setFriendsStatus("error");setError(exception.message||"Unable to connect to Firebase.")}}})();return()=>{dead=true;stops.forEach(stop=>stop())}},[authUser?.uid,authUser]);
 useEffect(()=>{if(!uid||!friendIds){setFriendPresence({});return}let dead=false,stops=[],sessionsByUid={};(async()=>{try{const app=await fbApp(),F=await import("firebase/firestore"),db=F.getFirestore(app);if(dead)return;const onError=(exception,source)=>{if(!dead){const failure=friendSubscriptions.friendListenerFailure(exception,source);console.error("[friends] Firestore listener failed",failure.diagnostic);setError(failure.message)}};for(const friendUid of friendIds.split("|")){stops.push(friendSubscriptions.subscribeFriendPresence(F,db,friendUid,{onPresence:sessions=>{sessionsByUid[friendUid]=sessions;setFriendPresence(current=>({...current,[friendUid]:presenceSessions.onlineFromSessions(sessions)}));setError("")},onError}))}}catch(exception){if(!dead)setError(exception.message||"Friend presence could not be loaded.")}})();const refresh=setInterval(()=>{setFriendPresence(current=>Object.fromEntries(Object.entries(sessionsByUid).map(([friendUid,sessions])=>[friendUid,presenceSessions.onlineFromSessions(sessions)])))},10000);return()=>{dead=true;clearInterval(refresh);stops.forEach(stop=>stop())}},[uid,friendIds]);
 const callFriendRequest=async(body)=>{if(!uid||!isFirestoreReady)throw new Error("Firebase Authentication and Firestore are not configured.");return callFriendApi(body)};
 const sendRequest=async(targetId,targetName)=>{if(!uid||!isFirestoreReady)throw new Error("Firebase Authentication and Firestore are not configured.");if(!targetId)throw new Error("Choose a valid Weebie account.");if(targetId===uid)throw new Error("You cannot add yourself.");if(friends.some(friend=>friend.id===targetId))throw new Error("Already friends.");if(outgoing.some(request=>request.recipientUid===targetId&&request.status==="pending"))throw new Error("A friend request is already pending.");try{return friendRequestUi.sentFriendRequestStatus(await callFriendRequest({operation:"send",recipientUid:targetId,recipientDisplayName:targetName||""}))}catch(exception){throw new Error(friendRequestUi.friendRequestErrorMessage(exception))}};
 const respond=async(request,action)=>{if(!uid||!isFirestoreReady)throw new Error("Firebase Authentication and Firestore are not configured.");try{return friendRequestUi.friendRequestResponseStatus(await callFriendRequest({operation:"respond",requestId:request.id,action}),action)}catch(exception){throw new Error(friendRequestUi.friendRequestErrorMessage(exception))}};
 const decline=request=>respond(request,"reject");
 const accept=request=>respond(request,"accept");
 const deleteFriend=async friendUid=>{await callFriendRequest({operation:"delete",friendUid});setFriends(current=>current.filter(friend=>friend.id!==friendUid))};
 const blockFriend=async friendUid=>{await callFriendRequest({operation:"block",friendUid});setFriends(current=>current.filter(friend=>friend.id!==friendUid))};
 const online=friend=>friendPresence[friend.id]===true;
 return {uid,name,friends:friends.map(friend=>({...friend,online:online(friend)})),friendsStatus,incoming,outgoing,error,sendRequest,accept,decline,deleteFriend,blockFriend,callFriendApi:callFriendRequest};
}

export function FriendsProvider({user,children}){
 const value=useFriendsState(user);
 return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(){
 const value=useContext(FriendsContext);
 if(!value)throw new Error("Friend features must be rendered inside the authenticated FriendsProvider.");
 return value;
}
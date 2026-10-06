"use client";
import {currentUser} from "./auth";
import {friendRequestErrorMessage} from "./friendRequestUi.cjs";

export async function callFriendApi(body){
 const user=await currentUser();
 if(!user)throw new Error("Sign in again before managing friends.");
 const idToken=await user.getIdToken();
 const response=await fetch("/api/friends",{method:"POST",credentials:"same-origin",headers:{Authorization:`Bearer ${idToken}`,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
 let result;
 try{result=await response.json()}catch{throw new Error("Weebie could not read the friends response.")}
 if(!response.ok){
  const error=new Error(result.error||"Could not complete the friends operation.");
  error.status=response.status;
  throw new Error(friendRequestErrorMessage(error));
 }
 return result;
}

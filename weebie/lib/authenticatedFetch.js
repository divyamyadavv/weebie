"use client";
import {currentUser} from "./auth";

export async function fetchWithFirebaseAuth(path,options={}){
 const user=await currentUser();
 if(!user)throw new Error("Sign in again before continuing.");
 const idToken=await user.getIdToken();
 const headers=new Headers(options.headers);
 headers.set("Authorization",`Bearer ${idToken}`);
 return fetch(path,{...options,credentials:"same-origin",cache:"no-store",headers});
}

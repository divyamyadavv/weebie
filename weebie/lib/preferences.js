"use client";
import {useCallback,useEffect,useState} from "react";
import {DEFAULT_PREFERENCES,readPreferences,writePreferences} from "./preferences.cjs";

const CHANGE_EVENT="weebie-preferences-changed";

export function usePreferences(uid){
 const [preferences,setPreferences]=useState(DEFAULT_PREFERENCES);
 useEffect(()=>{
  if(!uid){setPreferences(DEFAULT_PREFERENCES);return}
  const sync=()=>setPreferences(readPreferences(window.localStorage,uid));
  sync();
  window.addEventListener(CHANGE_EVENT,sync);
  window.addEventListener("storage",sync);
  return()=>{window.removeEventListener(CHANGE_EVENT,sync);window.removeEventListener("storage",sync)};
 },[uid]);
 const updatePreferences=useCallback(patch=>{
  if(!uid)return DEFAULT_PREFERENCES;
  const next=writePreferences(window.localStorage,uid,patch);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return next;
 },[uid]);
 return {preferences,updatePreferences};
}

// Per-account, per-device preferences (localStorage). Pure helpers so they can be unit-tested.
const DEFAULT_PREFERENCES=Object.freeze({
 friendRequestPopups:true, // show the friend-request pop-up card
 roomInvitePopups:true,    // show the room-invitation pop-up card
 pauseAllPopups:false,     // "Do not disturb": no pop-up cards at all (bell badges still update)
 appearOffline:false       // friends do not see this account as online
});
const KEY_PREFIX="weebie-preferences:";

function preferencesKey(uid){return `${KEY_PREFIX}${uid}`}

function normalizePreferences(raw){
 const result={...DEFAULT_PREFERENCES};
 if(raw&&typeof raw==="object")for(const key of Object.keys(DEFAULT_PREFERENCES))if(typeof raw[key]==="boolean")result[key]=raw[key];
 return result;
}

function readPreferences(storage,uid){
 if(!uid)return {...DEFAULT_PREFERENCES};
 try{const text=storage?.getItem(preferencesKey(uid));return normalizePreferences(text?JSON.parse(text):null)}
 catch{return {...DEFAULT_PREFERENCES}}
}

function writePreferences(storage,uid,patch){
 const next=normalizePreferences({...readPreferences(storage,uid),...patch});
 if(uid){try{storage?.setItem(preferencesKey(uid),JSON.stringify(next))}catch{}}
 return next;
}

function popupsAllowed(preferences,kind){
 if(preferences?.pauseAllPopups)return false;
 if(kind==="friendRequest")return preferences?.friendRequestPopups!==false;
 if(kind==="roomInvite")return preferences?.roomInvitePopups!==false;
 return true;
}

function isAppearOffline(storage,uid){return readPreferences(storage,uid).appearOffline===true}

module.exports={DEFAULT_PREFERENCES,preferencesKey,normalizePreferences,readPreferences,writePreferences,popupsAllowed,isAppearOffline};

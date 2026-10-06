const test=require("node:test");
const assert=require("node:assert/strict");
const {DEFAULT_PREFERENCES,normalizePreferences,readPreferences,writePreferences,popupsAllowed,isAppearOffline,preferencesKey}=require("../lib/preferences.cjs");

function memoryStorage(initial={}){const map=new Map(Object.entries(initial));return {getItem:key=>map.has(key)?map.get(key):null,setItem:(key,value)=>map.set(key,value),raw:map}}

test("defaults keep every notification on and the account visible",()=>{
 assert.deepEqual({...DEFAULT_PREFERENCES},{friendRequestPopups:true,roomInvitePopups:true,pauseAllPopups:false,appearOffline:false});
});

test("preferences are saved and read back per account",()=>{
 const storage=memoryStorage();
 writePreferences(storage,"alice",{appearOffline:true,roomInvitePopups:false});
 assert.equal(readPreferences(storage,"alice").appearOffline,true);
 assert.equal(readPreferences(storage,"alice").roomInvitePopups,false);
 assert.equal(readPreferences(storage,"alice").friendRequestPopups,true);
 assert.deepEqual(readPreferences(storage,"bob"),{...DEFAULT_PREFERENCES},"another account on the same device is unaffected");
});

test("a patch merges with what was saved instead of replacing it",()=>{
 const storage=memoryStorage();
 writePreferences(storage,"alice",{pauseAllPopups:true});
 writePreferences(storage,"alice",{appearOffline:true});
 const saved=readPreferences(storage,"alice");
 assert.equal(saved.pauseAllPopups,true);
 assert.equal(saved.appearOffline,true);
});

test("corrupted or hostile storage falls back to safe defaults",()=>{
 assert.deepEqual(readPreferences(memoryStorage({[preferencesKey("alice")]:"{not json"}),"alice"),{...DEFAULT_PREFERENCES});
 assert.deepEqual(normalizePreferences({friendRequestPopups:"no",appearOffline:1,extra:true}),{...DEFAULT_PREFERENCES});
 assert.deepEqual(readPreferences(null,"alice"),{...DEFAULT_PREFERENCES});
 assert.deepEqual(readPreferences(memoryStorage(),""),{...DEFAULT_PREFERENCES});
});

test("pop-ups follow each switch, and Do not disturb overrides both",()=>{
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES},"friendRequest"),true);
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES,friendRequestPopups:false},"friendRequest"),false);
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES,friendRequestPopups:false},"roomInvite"),true);
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES,roomInvitePopups:false},"roomInvite"),false);
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES,pauseAllPopups:true},"friendRequest"),false);
 assert.equal(popupsAllowed({...DEFAULT_PREFERENCES,pauseAllPopups:true},"roomInvite"),false);
});

test("appear-offline is read from the saved preference",()=>{
 const storage=memoryStorage();
 assert.equal(isAppearOffline(storage,"alice"),false);
 writePreferences(storage,"alice",{appearOffline:true});
 assert.equal(isAppearOffline(storage,"alice"),true);
 assert.equal(isAppearOffline(storage,"bob"),false);
});

const test=require("node:test");
const assert=require("node:assert/strict");
const {expectedPlaybackPosition,playbackCorrection,shouldApplyPlaybackState}=require("../lib/playbackSync.cjs");

test("projects playback time from a monotonic receive anchor",()=>{
 assert.equal(expectedPlaybackPosition({time:12,playing:true,receivedAt:5000},7000),14);
 assert.equal(expectedPlaybackPosition({time:12,playing:false,receivedAt:5000},7000),12);
});

test("uses the server timestamp for bounded late-state age",()=>{
 assert.equal(expectedPlaybackPosition({time:12,playing:true,receivedAt:5000,serverTimestamp:10000,wallClockAtReceive:12000},7000),16);
 assert.equal(expectedPlaybackPosition({time:12,playing:true,receivedAt:5000,serverTimestamp:1000,wallClockAtReceive:10000},7000),18);
});

test("projects time at the host-selected playback speed",()=>{
 assert.equal(expectedPlaybackPosition({time:12,playing:true,playbackRate:1.5,receivedAt:5000},7000),15);
 assert.equal(expectedPlaybackPosition({time:12,playing:true,playbackRate:8,receivedAt:5000},7000),14);
});

test("corrects small drift smoothly and rate-limits large seeks",()=>{
 assert.deepEqual(playbackCorrection(0.1,"progress",0,10000),{seek:false,playbackRate:1});
 assert.deepEqual(playbackCorrection(0.8,"progress",0,10000),{seek:false,playbackRate:1.04});
 assert.deepEqual(playbackCorrection(-0.8,"progress",0,10000),{seek:false,playbackRate:0.96});
 assert.deepEqual(playbackCorrection(1,"seeked",0,10000),{seek:true,playbackRate:1});
 assert.deepEqual(playbackCorrection(4,"progress",5000,10000),{seek:false,playbackRate:1.04});
 assert.deepEqual(playbackCorrection(4,"progress",1000,10000),{seek:true,playbackRate:1});
 assert.deepEqual(playbackCorrection(0.8,"progress",0,10000,1.5),{seek:false,playbackRate:1.56});
});

test("applies the host's initial room snapshot but ignores later self snapshots",()=>{
 const hostState={controllerId:"host",playing:false,time:42};
 assert.equal(shouldApplyPlaybackState(hostState,"host",false),true);
 assert.equal(shouldApplyPlaybackState(hostState,"host",true),false);
 assert.equal(shouldApplyPlaybackState({...hostState,controllerId:"guest"},"host",true),true);
 assert.equal(shouldApplyPlaybackState(null,"host",false),false);
});
const test=require("node:test");
const assert=require("node:assert/strict");
const {isDriveVideoMime,normalizeDriveVideoMime}=require("../lib/driveVideoMime.cjs");

test("accepts common and uncommon Drive video MIME types",()=>{
 for(const mime of ["video/mp4","video/webm","video/ogg","video/x-matroska","video/quicktime","video/x-msvideo"]){
  assert.equal(isDriveVideoMime(mime),true,mime);
 }
});

test("normalizes MIME parameters and rejects non-video content",()=>{
 assert.equal(normalizeDriveVideoMime(" VIDEO/MP4; codecs=avc1 "),"video/mp4");
 assert.equal(isDriveVideoMime("application/octet-stream"),false);
 assert.equal(isDriveVideoMime("audio/mp4"),false);
 assert.equal(isDriveVideoMime(""),false);
});
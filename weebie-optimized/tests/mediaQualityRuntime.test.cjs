const test=require("node:test");
const assert=require("node:assert/strict");
const path=require("node:path");
const {mediaToolStatus,resolveQualityStorageRoot}=require("../lib/mediaQualityRuntime.cjs");

test("missing FFmpeg or FFprobe prevents quality preparation",()=>{
 const status=mediaToolStatus({FFMPEG_PATH:"missing-weebie-ffmpeg",FFPROBE_PATH:"missing-weebie-ffprobe"});
 assert.deepEqual(status,{ffmpeg:false,ffprobe:false,ready:false});
});

test("production quality storage must be explicitly configured",()=>{
 assert.throws(()=>resolveQualityStorageRoot({nodeEnv:"production",mediaDir:"",cwd:"/srv/app"}),/WEEBIE_MEDIA_DIR/);
 assert.equal(resolveQualityStorageRoot({nodeEnv:"production",mediaDir:"/srv/private-media",cwd:"/srv/app"}),path.resolve("/srv/private-media"));
});

test("development uses a private local storage directory by default",()=>{
 assert.equal(resolveQualityStorageRoot({nodeEnv:"development",mediaDir:"",cwd:"/workspace/weebie"}),path.resolve("/workspace/weebie/.weebie/qualities"));
});

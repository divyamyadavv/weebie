const {spawnSync}=require("node:child_process");
const path=require("node:path");

function mediaToolStatus(environment=process.env){
 const ffmpeg=spawnSync(environment.FFMPEG_PATH||"ffmpeg",["-version"],{stdio:"ignore"});
 const ffprobe=spawnSync(environment.FFPROBE_PATH||"ffprobe",["-version"],{stdio:"ignore"});
 return {ffmpeg:ffmpeg.status===0,ffprobe:ffprobe.status===0,ready:ffmpeg.status===0&&ffprobe.status===0};
}

function resolveQualityStorageRoot({nodeEnv=process.env.NODE_ENV,mediaDir=process.env.WEEBIE_MEDIA_DIR,cwd=process.cwd()}={}){
 if(nodeEnv==="production"&&!mediaDir)throw new Error("Quality preparation requires WEEBIE_MEDIA_DIR to point to durable private server storage.");
 return path.resolve(mediaDir||path.join(cwd,".weebie","qualities"));
}

module.exports={mediaToolStatus,resolveQualityStorageRoot};

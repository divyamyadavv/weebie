function normalizeDriveVideoMime(value){
 return String(value||"").split(";")[0].trim().toLowerCase();
}

function isDriveVideoMime(value){
 return normalizeDriveVideoMime(value).startsWith("video/");
}

module.exports={isDriveVideoMime,normalizeDriveVideoMime};
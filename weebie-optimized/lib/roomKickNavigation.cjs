function isCurrentUserKicked(currentUserId,targetUserId,action){
 return Boolean(currentUserId&&currentUserId===targetUserId&&action==="kick");
}

module.exports={isCurrentUserKicked};

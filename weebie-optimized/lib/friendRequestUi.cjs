function claimFriendRequestPopup(request,storage){
 if(!request?.id)return false;
 const createdAt=request.createdAt?.toMillis?.()??request.createdAt?.seconds??request.createdAt??"pending";
 const key=`weebie-friend-notice:${request.id}:${createdAt}`;
 try{
  if(storage.getItem(key)==="1")return false;
  storage.setItem(key,"1");
  if(storage.getItem(key)!=="1")return false;
  return true;
 }catch{return true}
}

function claimNextFriendRequestPopup(requests,storage,skipId=null){
 return requests.find(request=>request.id!==skipId&&claimFriendRequestPopup(request,storage))||null;
}

function friendRequestErrorMessage(error){
 const code=String(error?.code||"").replace(/^functions\//,"");
 if(code==="unauthenticated")return "Sign in again with a verified Weebie account before managing friend requests.";
 if(code==="permission-denied")return "You do not have permission to manage this friend request.";
 if(code==="failed-precondition")return "This friend request is no longer pending. Refresh your requests and try again.";
 if(error?.status===401)return "Sign in again with a verified Weebie account before managing friend requests.";
 if(error?.status===403)return "Verify your email before managing friend requests.";
 if(error?.status===404)return "That friend request no longer exists.";
 if(error?.status===409)return "This friend request is no longer pending. Refresh your requests and try again.";
 if(["unavailable","deadline-exceeded","network-request-failed"].includes(code))return "Could not reach Weebie right now. Check your connection and try again.";
 const message=typeof error?.message==="string"?error.message.replace(/^Firebase:\s*/,"").trim():"";
 return message||"Could not complete the friend request. Please try again.";
}

function sentFriendRequestStatus(result){
 const status=result?.data?.status;
 if(status==="already-friends")throw new Error("Already friends.");
 if(status==="pending")throw new Error("A friend request is already pending.");
 if(status!=="sent"&&status!=="accepted")throw new Error("We could not confirm that your friend request was sent. Refresh your requests and try again.");
 return status;
}

function friendRequestResponseStatus(result,action){
 const expected=action==="accept"?"accepted":"rejected";
 if(result?.data?.status!==expected)throw new Error("We could not confirm that the friend request was updated. Refresh your requests and try again.");
 return result.data.status;
}

module.exports={claimFriendRequestPopup,claimNextFriendRequestPopup,friendRequestErrorMessage,sentFriendRequestStatus,friendRequestResponseStatus};
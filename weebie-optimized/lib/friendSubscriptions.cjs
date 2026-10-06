function friendRows(snapshot){
 return snapshot.docs.map(item=>({...item.data(),id:item.id}));
}

function friendListenerFailure(error,source){
 const code=typeof error?.code==="string"&&/^[a-z0-9-]+$/i.test(error.code)?error.code:"unknown";
 const diagnostic={listener:source.listener,path:source.path,code};
 const message=code==="permission-denied"
  ?`${source.listener}: Firestore denied access. Confirm the deployed rules allow this signed-in user to read the listener path.`
  :`${source.listener}: Firestore request failed (${code}).`;
 return {diagnostic,message};
}

function subscribeFriendData(F,db,uid,{onIncoming,onOutgoing,onFriends,onError}){
 const requests=F.collection(db,"friendRequests"),watch=(listener,path,query,onValue)=>F.onSnapshot(query,snapshot=>onValue(friendRows(snapshot)),error=>onError(error,{listener,path}));
 return [
  watch("Incoming friend requests","friendRequests (recipientUid == current user)",F.query(requests,F.where("recipientUid","==",uid)),rows=>onIncoming(rows.filter(request=>request.status==="pending"))),
  watch("Outgoing friend requests","friendRequests (senderUid == current user)",F.query(requests,F.where("senderUid","==",uid)),onOutgoing),
  watch("Accepted friendships","users/{currentUserUid}/friends",F.collection(db,"users",uid,"friends"),onFriends)
 ];
}

function subscribeFriendPresence(F,db,uid,{onPresence,onError}){
 const path=`users/{friendUid}/presenceSessions`;
 return F.onSnapshot(F.collection(db,"users",uid,"presenceSessions"),snapshot=>onPresence(snapshot.docs.map(item=>item.data())),error=>onError(error,{listener:"Friend presence",path}));
}

module.exports={friendRows,friendListenerFailure,subscribeFriendData,subscribeFriendPresence};
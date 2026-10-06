// Pure helpers for client-side room presence recovery and admin resolution.

// Decide what the client should do when the server rejects a presence heartbeat.
//  - "rejoin":   the tab's presence session no longer exists (409). That happens after pagehide/bfcache
//                restore, a long sleep, or server pruning. The tab is still open, so it must re-create its
//                own session instead of silently staying a ghost.
//  - "terminal": the account is not allowed in the room (403) or the room is gone (404). Never retry.
//  - "retry":    transient failure (network, 5xx). Keep the normal retry cadence.
function classifyPresenceFailure(error){
 const status=Number(error?.status);
 if(status===409)return "rejoin";
 if(status===403||status===404)return "terminal";
 return "retry";
}

// A room whose adminId is explicitly null has no active admin right now (everyone left). Only a legacy
// document that has no adminId field at all may fall back to its original host.
function resolveRoomAdminId(room){
 if(!room||typeof room!=="object")return null;
 if(Object.prototype.hasOwnProperty.call(room,"adminId"))return room.adminId||null;
 return room.hostId||null;
}

module.exports={classifyPresenceFailure,resolveRoomAdminId};

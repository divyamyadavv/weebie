const MAX_ROOM_NAME_LENGTH=80;
const DRIVE_ROOM_SUFFIX=" watch party";

function makeDriveRoomName(fileName){
 const name=String(fileName||"Drive video").trim()||"Drive video";
 return `${name.slice(0,MAX_ROOM_NAME_LENGTH-DRIVE_ROOM_SUFFIX.length)}${DRIVE_ROOM_SUFFIX}`;
}

module.exports={makeDriveRoomName};
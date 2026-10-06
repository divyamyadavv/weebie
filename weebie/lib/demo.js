export const getRooms=()=>{try{return JSON.parse(localStorage.getItem("weebie_rooms")||"[]")}catch{return []}};
export const saveRoom=r=>localStorage.setItem("weebie_rooms",JSON.stringify([r,...getRooms()]));
export const makeCode=()=>Math.random().toString(36).slice(2,8).toUpperCase();

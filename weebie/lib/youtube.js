export function ytId(u){try{const x=new URL(u.trim()),p=x.pathname.split("/").filter(Boolean);let id=null;
 if(x.hostname==="youtu.be")id=p[0];else if(/(^|\.)youtube\.com$/.test(x.hostname))id=p[0]==="watch"||!p[0]?x.searchParams.get("v"):["embed","shorts","live"].includes(p[0])?p[1]:null;
 return /^[\w-]{11}$/.test(id||"")?id:null}catch{return null}}
let P;export const loadYT=()=>P||(P=new Promise(res=>{if(window.YT?.Player)return res(window.YT);const s=document.createElement("script");s.src="https://www.youtube.com/iframe_api";document.head.appendChild(s);window.onYouTubeIframeAPIReady=()=>res(window.YT)}));

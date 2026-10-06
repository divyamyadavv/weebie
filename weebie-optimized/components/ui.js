import Link from "next/link";
import Image from "next/image";
export function Avatar({name="D",photoURL,size="h-9 w-9"}){return photoURL?<Image src={photoURL} alt={`${name}'s profile photo`} width={56} height={56} unoptimized className={`${size} shrink-0 rounded-full object-cover`}/>:<span className={`${size} grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-bold`}>{name[0]?.toUpperCase()}</span>}
export const Poster=({t,s,g})=><div className="card group cursor-pointer overflow-hidden"><div className={`aspect-[3/4] bg-gradient-to-br ${g} transition group-hover:scale-105`}/><div className="p-2"><p className="truncate text-xs font-semibold">{t}</p><p className="text-[11px] text-slate-400">{s}</p></div></div>;

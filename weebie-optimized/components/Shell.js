"use client";
import Link from "next/link";import {useEffect} from "react";
import {usePathname,useRouter} from "next/navigation";
import {Home,Users,Settings,Plus,UserPlus} from "lucide-react";
import Logo from "./Logo";import {Avatar} from "./ui";import {useAuth} from "./AuthProvider";
const nav=[["/dashboard","Home",Home],["/rooms","My Rooms",Users],["/friends","Friends",UserPlus],["/settings","Settings",Settings]];
export default function Shell({children,onSearch}){
 const p=usePathname(),r=useRouter(),{user,loading,requiresVerification}=useAuth();useEffect(()=>{if(!loading&&!user)r.replace(`/login?next=${encodeURIComponent(p)}`);else if(!loading&&user&&requiresVerification)r.replace(`/verify-email?next=${encodeURIComponent(p)}`)},[loading,user,requiresVerification,r,p]);
 if(loading||!user||requiresVerification)return <div className="grid min-h-screen place-items-center text-sm text-slate-400">{requiresVerification?"Verify your email to continue...":"Checking your account..."}</div>;
 const u={name:user.displayName||user.email?.split("@")[0]||"Account",email:user.email||"",photoURL:user.photoURL||null};
 return <div className="flex min-h-screen">
  <aside className="sticky top-0 hidden h-screen w-60 flex-col border-r border-white/10 bg-panel/80 p-4 md:flex">
   <Logo/><nav className="mt-8 flex-1 space-y-1">{nav.map(([h,l,I])=><Link key={l} href={h} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition hover:bg-violet-500/10 ${p===h.split("#")[0]&&(l!=="Favorites"&&l!=="Watch History")?"bg-violet-600/30 text-white":"text-slate-300"}`}><I size={18}/>{l}</Link>)}</nav>
  <div className="flex items-center gap-2"><Avatar name={u.name} photoURL={u.photoURL}/><div className="min-w-0 text-xs"><p className="font-semibold">{u.name}</p><p className="truncate text-slate-400">{u.email}</p></div></div>
  </aside>
  <div className="min-w-0 flex-1">
   <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-ink/80 p-3 backdrop-blur md:p-4">
    <div className="md:hidden"><Logo size="text-lg"/></div>
    <div className="flex-1"/>
    <div className="ml-auto flex items-center gap-3"><Link href="/rooms/new" className="btn !py-2"><Plus size={16}/>Create Room</Link></div>
   </header>
   <nav className="flex gap-1 overflow-x-auto border-b border-white/10 p-2 md:hidden">{nav.map(([h,l,I])=><Link key={l} href={h} className="flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-violet-500/10"><I size={14}/>{l}</Link>)}</nav>
    <main className="p-4 md:p-6">{children}</main>
  </div></div>}

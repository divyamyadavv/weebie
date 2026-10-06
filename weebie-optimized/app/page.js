"use client";
import Link from "next/link";
import {useEffect} from "react";
import {useRouter} from "next/navigation";
import Logo from "../components/Logo";
import {useAuth} from "../components/AuthProvider";
import {landingDestination} from "../lib/authNavigation.cjs";
import {Play,MessageCircle,LogIn,Lock,Heart} from "lucide-react";
const F=[[Play,"Watch Together","Sync play, pause, seek"],[MessageCircle,"Live Chat","Real-time messaging"],[LogIn,"Google Login","Quick & secure (Firebase)"],[Lock,"Private Rooms","Just you and your people"]];
export default function Landing(){
 const router=useRouter(),{user,loading,requiresVerification}=useAuth(),destination=landingDestination(user,requiresVerification);
 useEffect(()=>{if(!loading&&destination)router.replace(destination)},[loading,destination,router]);
 if(loading||destination)return <div className="grid min-h-screen place-items-center text-sm text-slate-400">Checking your account...</div>;
 return <div>
 <header className="sticky top-0 z-30 flex items-center justify-between gap-4 bg-ink/70 px-5 py-4 backdrop-blur md:px-10"><Logo/>
  <nav className="hidden gap-8 text-sm text-slate-300 md:flex">{[["#top","Home"],["#features","Features"],["#how","How it works"],["#about","About"]].map(([h,l])=><a key={l} href={h} className="hover:text-white">{l}</a>)}</nav>
  <Link href="/login" className="btn !py-2">Sign In</Link></header>
 <section id="top" className="relative overflow-hidden px-5 py-20 md:px-10 md:py-32">
  <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-900/40 via-ink to-indigo-950/60"/>
  <div className="absolute right-0 top-10 -z-10 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl"/>
  <div className="fade max-w-2xl"><h1 className="text-4xl font-extrabold leading-tight md:text-6xl">Watch Together,<br/>Stay <span className="text-violet-400">Closer</span> <Heart className="inline text-red-500" fill="currentColor" size={40}/></h1>
  <p className="mt-6 text-lg text-slate-300">Create private rooms, watch movies and anime together, and chat in real time.</p>
  <div className="mt-8 flex flex-wrap gap-3"><Link href="/signup" className="btn">Get Started</Link><a href="#features" className="btn2">Learn More</a></div></div>
 </section>
 <section id="features" className="grid gap-4 px-5 pb-16 sm:grid-cols-2 md:px-10 lg:grid-cols-4">{F.map(([I,t,d])=><div key={t} className="card p-5"><span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-violet-600/30 text-violet-300"><I size={20}/></span><h3 className="font-semibold">{t}</h3><p className="text-sm text-slate-400">{d}</p></div>)}</section>
 <section id="how" className="px-5 pb-16 md:px-10"><h2 className="mb-6 text-2xl font-bold">How it works</h2><div className="grid gap-4 md:grid-cols-3">{["Create a private room","Share the invite link or code","Press play together and chat"].map((t,i)=><div key={t} className="card p-5"><p className="text-3xl font-extrabold text-violet-400">0{i+1}</p><p className="mt-2">{t}</p></div>)}</div></section>
 <section id="about" className="px-5 pb-20 md:px-10"><h2 className="mb-2 text-2xl font-bold">About</h2><p className="max-w-2xl text-slate-400">Weebie is a watch-party app for people who live far apart. Bring your own video links; Weebie does not host or provide licensed content.</p></section>
</div>}

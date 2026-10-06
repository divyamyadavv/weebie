"use client";
import Link from "next/link";
import {Play} from "lucide-react";
import {useAuth} from "./AuthProvider";
import {logoDestination} from "../lib/authNavigation.cjs";

export default function Logo({href,size="text-2xl"}){
 const {user,loading}=useAuth(),destination=logoDestination(user,href);
 return <Link href={destination} aria-disabled={loading||undefined} onClick={event=>{if(loading)event.preventDefault()}} className={`flex items-center gap-2 font-bold ${size}`}><span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-600 to-purple-400 shadow-[0_0_16px_rgba(139,92,246,.6)]"><Play size={16} fill="white"/></span>Weebie</Link>;
}

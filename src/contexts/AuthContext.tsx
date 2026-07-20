import {createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {Session,User} from '@supabase/supabase-js';
import {supabase,isSupabaseConfigured} from '../lib/supabase';
import type {Profile} from '../types';

type Ctx={session:Session|null;user:User|null;profile:Profile|null;loading:boolean;signOut:()=>Promise<void>;refreshProfile:()=>Promise<void>};
const AuthContext=createContext<Ctx|null>(null);

export function AuthProvider({children}:{children:React.ReactNode}){
 const [session,setSession]=useState<Session|null>(null);
 const [profile,setProfile]=useState<Profile|null>(null);
 const [loading,setLoading]=useState(true);
 const loadSequence=useRef(0);
 const load=async(uid?:string)=>{
  const sequence=++loadSequence.current;
  if(!uid){setProfile(null);return}
  setProfile(null);
  const {data,error}=await supabase.from('profiles').select('*').eq('id',uid).maybeSingle();
  if(sequence!==loadSequence.current)return;
  if(error){console.error('Profile load failed',error);setProfile(null);return}
  setProfile(data as Profile|null);
 };
 useEffect(()=>{
  if(!isSupabaseConfigured){setLoading(false);return}
  let mounted=true;
  supabase.auth.getSession().then(async({data})=>{
   if(!mounted)return;
   setSession(data.session);
   await load(data.session?.user.id);
   if(mounted)setLoading(false);
  });
  const {data:s}=supabase.auth.onAuthStateChange((_event,next)=>{
   setSession(next);
   setProfile(null);
   void load(next?.user.id).finally(()=>{if(mounted)setLoading(false)});
  });
  return()=>{mounted=false;s.subscription.unsubscribe()};
 },[]);
 const value=useMemo(()=>({session,user:session?.user??null,profile,loading,signOut:async()=>{setProfile(null);await supabase.auth.signOut()},refreshProfile:async()=>load(session?.user.id)}),[session,profile,loading]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('AuthProvider missing');return c};

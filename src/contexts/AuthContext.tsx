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
 const loadedProfileUserId=useRef<string|null>(null);
 const load=async(uid?:string)=>{
  const sequence=++loadSequence.current;
  if(!uid){loadedProfileUserId.current=null;setProfile(null);return}
  const {data,error}=await supabase.from('profiles').select('*').eq('id',uid).maybeSingle();
  if(sequence!==loadSequence.current)return;
  if(error){console.error('Profile load failed',error);return}
  loadedProfileUserId.current=uid;
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
   const nextUserId=next?.user.id;
   if(!nextUserId){loadedProfileUserId.current=null;setProfile(null)}
   else {
    // Token refreshes are common when a mobile browser/PWA returns from the
    // background. Keep the last valid profile visible while refreshing it.
    // Clear only when the authenticated account actually changed.
    if(loadedProfileUserId.current&&loadedProfileUserId.current!==nextUserId)setProfile(null);
    void load(nextUserId).finally(()=>{if(mounted)setLoading(false)});
   }
  });
  const refreshVisibleProfile=()=>{
   if(document.visibilityState!=='visible')return;
   void supabase.auth.getSession().then(({data})=>load(data.session?.user.id));
  };
  document.addEventListener('visibilitychange',refreshVisibleProfile);
  window.addEventListener('online',refreshVisibleProfile);
  return()=>{
   mounted=false;
   s.subscription.unsubscribe();
   document.removeEventListener('visibilitychange',refreshVisibleProfile);
   window.removeEventListener('online',refreshVisibleProfile);
  };
 },[]);
 const value=useMemo(()=>({session,user:session?.user??null,profile,loading,signOut:async()=>{loadedProfileUserId.current=null;setProfile(null);await supabase.auth.signOut()},refreshProfile:async()=>load(session?.user.id)}),[session,profile,loading]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>{const c=useContext(AuthContext);if(!c)throw new Error('AuthProvider missing');return c};

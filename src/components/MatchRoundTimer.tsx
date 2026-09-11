import {useEffect,useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Clock3,Pause,Play,RefreshCcw,TimerReset} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '../contexts/AuthContext';
import {canManage,useGroup} from '../hooks/useGroup';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import type {Match} from '../types';
import {Badge,Button,Card,Input} from './ui';

type TimerState={
 match_id:string;duration_seconds:number;remaining_seconds:number;
 status:'idle'|'running'|'paused'|'finished';started_at:string|null;updated_at:string;
};

const formatTime=(seconds:number)=>`${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.max(0,seconds%60).toString().padStart(2,'0')}`;

export function MatchRoundTimer({match}:{match:Match}){
 const {user}=useAuth();
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const [now,setNow]=useState(Date.now());
 const [minutes,setMinutes]=useState('7');
 const alerted=useRef(false);
 const audioContext=useRef<AudioContext|null>(null);
 const key=['match-round-timer',match.id] as const;
 const canManageTimer=match.created_by===user?.id||canManage(g,'enter_results');

 const {data,error}=useQuery({
  queryKey:key,
  refetchInterval:15000,
  queryFn:async()=>{
   const {data,error}=await supabase.from('match_round_timers').select('match_id,duration_seconds,remaining_seconds,status,started_at,updated_at').eq('match_id',match.id).maybeSingle();
   if(error)throw error;
   return data as TimerState|null;
  },
 });
 useRealtimeInvalidation(`round-timer-${match.id}`,['match_round_timers'],[key],true);

 useEffect(()=>{if(data?.duration_seconds)setMinutes(String(data.duration_seconds/60))},[data?.duration_seconds]);
 useEffect(()=>{
  if(data?.status!=='running')return;
  setNow(Date.now());
  const interval=window.setInterval(()=>setNow(Date.now()),250);
  return()=>window.clearInterval(interval);
 },[data?.status,data?.started_at]);

 const remaining=useMemo(()=>{
  if(!data)return 420;
  if(data.status!=='running'||!data.started_at)return data.remaining_seconds;
  return Math.max(0,data.remaining_seconds-Math.floor((now-new Date(data.started_at).getTime())/1000));
 },[data,now]);
 const duration=data?.duration_seconds||420;
 const status=data?.status==='running'&&remaining===0?'finished':data?.status||'idle';
 const progress=Math.max(0,Math.min(1,remaining/duration));

 const armAudio=()=>{
  try{
   if(!audioContext.current)audioContext.current=new AudioContext();
   void audioContext.current.resume();
  }catch{}
 };
 const playWhistle=()=>{
  try{
   const context=audioContext.current;
   if(!context)return;
   const start=context.currentTime;
   [0,.18].forEach((delay,index)=>{
    const oscillator=context.createOscillator();
    const gain=context.createGain();
    oscillator.type='square';
    oscillator.frequency.value=index?880:740;
    gain.gain.setValueAtTime(.0001,start+delay);
    gain.gain.exponentialRampToValueAtTime(.12,start+delay+.015);
    gain.gain.exponentialRampToValueAtTime(.0001,start+delay+.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start+delay);
    oscillator.stop(start+delay+.17);
   });
  }catch{}
 };
 useEffect(()=>{
  if(status==='finished'&&!alerted.current){
   alerted.current=true;
   playWhistle();
   navigator.vibrate?.([180,90,260]);
  }
  if(remaining>0)alerted.current=false;
 },[status,remaining]);

 const refresh=()=>qc.invalidateQueries({queryKey:key});
 const configure=useMutation({
  mutationFn:async()=>{
   const seconds=Math.round(Number(minutes)*60);
   if(!Number.isFinite(seconds)||seconds<30||seconds>5400)throw new Error('יש לבחור זמן בין חצי דקה ל־90 דקות');
   const {error}=await supabase.rpc('set_match_round_timer',{p_match_id:match.id,p_duration_seconds:seconds});
   if(error)throw error;
  },
  onSuccess:()=>{toast.success('הטיימר הוגדר ואופס');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const start=useMutation({
  mutationFn:async()=>{const {error}=await supabase.rpc('start_match_round_timer',{p_match_id:match.id});if(error)throw error},
  onSuccess:()=>{toast.success(status==='paused'?'הטיימר ממשיך':'הסבב התחיל');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const pause=useMutation({
  mutationFn:async()=>{const {error}=await supabase.rpc('pause_match_round_timer',{p_match_id:match.id});if(error)throw error},
  onSuccess:()=>{toast.success('הטיימר נעצר');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const busy=configure.isPending||start.isPending||pause.isPending;
 const editable=canManageTimer&&match.status==='teams_published'&&!match.ratings_open;
 const statusLabel=status==='running'?'רץ עכשיו':status==='paused'?'מושהה':status==='finished'?'הסבב הסתיים':'מוכן לסבב';
 const startLabel=status==='paused'?'המשך':status==='finished'?'סבב חדש':'התחלה';

 if(!['teams_published','completed'].includes(match.status))return null;
 return <Card className={`match-round-timer ${status}`}>
  <header className="match-timer-head">
   <div><span><Clock3 size={20}/></span><div><small>ROUND TIMER</small><h2>טיימר משחקון</h2><p>הזמן משותף ומסונכרן לכל מי שצופה במשחק.</p></div></div>
   <Badge>{statusLabel}</Badge>
  </header>
  {error&&<div className="goal-notice danger">לא הצלחנו לטעון את הטיימר. יש לוודא שמיגרציה 043 הותקנה.</div>}
  <div className="match-timer-body">
   <div className="match-timer-dial" style={{'--timer-progress':`${progress*360}deg`} as React.CSSProperties} aria-live="polite" aria-label={`${Math.floor(remaining/60)} דקות ו-${remaining%60} שניות`}>
    <div><strong>{formatTime(remaining)}</strong><span>{status==='finished'?'סיום!':'דקות : שניות'}</span></div>
   </div>
   {editable&&<div className="match-timer-panel">
    <div className="match-timer-duration"><label htmlFor={`round-minutes-${match.id}`}>משך משחקון בדקות</label><Input id={`round-minutes-${match.id}`} type="number" min="0.5" max="90" step="0.5" inputMode="decimal" value={minutes} disabled={busy||status==='running'} onChange={event=>setMinutes(event.target.value)}/><Button variant="secondary" disabled={busy||status==='running'} onClick={()=>((status==='paused'||status==='finished')?confirm('שמירת הזמן החדש תאפס את הטיימר. להמשיך?'):true)&&configure.mutate()}><TimerReset size={17}/>הגדרה ואיפוס</Button></div>
    <div className="match-timer-actions">
     {status==='running'?<Button disabled={busy} onClick={()=>pause.mutate()}><Pause size={18}/>עצירה</Button>:<Button disabled={busy} onClick={()=>{armAudio();start.mutate()}}><Play size={18}/>{startLabel}</Button>}
     {data&&status!=='idle'&&<Button variant="secondary" disabled={busy||status==='running'} onClick={()=>confirm('לאפס את הטיימר לזמן שהוגדר?')&&configure.mutate()}><RefreshCcw size={17}/>איפוס</Button>}
    </div>
   </div>}
  </div>
 </Card>;
}

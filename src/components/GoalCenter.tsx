import {useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,CircleX,Clock3,Crown,Goal,ShieldCheck,Trash2,UserCheck} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '../contexts/AuthContext';
import {canManage,useGroup} from '../hooks/useGroup';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import {fullName} from '../lib/utils';
import type {Match,Registration} from '../types';
import {Badge,Button,Card,Select} from './ui';

type GoalEvent={
 id:string;scorer_user_id:string;reported_by:string;status:'pending'|'approved'|'rejected'|'cancelled';created_at:string;
 scorer?:{first_name?:string;last_name?:string};reporter?:{first_name?:string;last_name?:string};team?:{name?:string;color_key?:string}|null;
};

const requestId=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
const goalName=(profile?:{first_name?:string;last_name?:string})=>[profile?.first_name,profile?.last_name].filter(Boolean).join(' ')||'שחקן';

export function GoalCenter({match,registrations}:{match:Match;registrations:Registration[]}){
 const {user}=useAuth();
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const [scorer,setScorer]=useState('');
 const reportRequest=useRef(requestId());
 const directRequest=useRef(requestId());
 const key=['match-goals',match.id] as const;
 const matchKey=['match',match.id] as const;
 const {data,isLoading,error}=useQuery({
  queryKey:key,
  refetchInterval:30000,
  queryFn:async()=>{
   const [{data:events,error},{data:reportingOpen,error:openError}]=await Promise.all([
    supabase.from('goal_events').select('id,scorer_user_id,reported_by,status,created_at,scorer:profiles!goal_events_scorer_user_id_fkey(first_name,last_name),reporter:profiles!goal_events_reported_by_fkey(first_name,last_name),team:teams(name,color_key)').eq('match_id',match.id).order('created_at',{ascending:false}),
    supabase.rpc('match_goal_reporting_open',{p_match_id:match.id})
   ]);
   if(error)throw error;
   if(openError)throw openError;
   return{events:(events||[]) as unknown as GoalEvent[],reportingOpen:Boolean(reportingOpen)};
  }
 });
 useRealtimeInvalidation(`goals-${match.id}`,['goal_events'],[key,['v2-stats',match.group_id],['player-card']],true);

 const refresh=()=>{
  qc.invalidateQueries({queryKey:key});
  qc.invalidateQueries({queryKey:matchKey});
  qc.invalidateQueries({queryKey:['v2-stats',match.group_id]});
  qc.invalidateQueries({queryKey:['player-card']});
 };
 const confirmed=registrations.filter(r=>r.registration_status==='confirmed');
 const participants=confirmed.filter(r=>r.attended);
 const scorerId=scorer||participants[0]?.user_id||'';
 const mine=participants.some(r=>r.user_id===user?.id);
 const registered=confirmed.some(r=>r.user_id===user?.id);
 const canManageGoals=match.created_by===user?.id||canManage(g,'enter_results');
 const canManageAttendance=match.created_by===user?.id||canManage(g,'open_ratings');
 const startAt=new Date(`${match.match_date}T${match.start_time}`);
 const started=Date.now()>=startAt.getTime();

 const report=useMutation({mutationFn:async()=>{const {error}=await supabase.rpc('report_match_goal',{p_match_id:match.id,p_scorer_user_id:scorerId,p_client_request_id:reportRequest.current});if(error)throw error},onSuccess:()=>{reportRequest.current=requestId();toast.success('דיווח השער נשלח לאישור');refresh()},onError:(e:any)=>toast.error(e.message)});
 const addDirect=useMutation({mutationFn:async()=>{const {error}=await supabase.rpc('add_approved_match_goal',{p_match_id:match.id,p_scorer_user_id:scorerId,p_client_request_id:directRequest.current});if(error)throw error},onSuccess:()=>{directRequest.current=requestId();toast.success('השער נוסף ואושר');refresh()},onError:(e:any)=>toast.error(e.message)});
 const review=useMutation({mutationFn:async({goalId,approve}:{goalId:string;approve:boolean})=>{const {error}=await supabase.rpc('review_goal_report',{p_goal_id:goalId,p_approve:approve});if(error)throw error;return approve},onSuccess:approved=>{toast.success(approved?'השער אושר':'הדיווח נדחה');refresh()},onError:(e:any)=>toast.error(e.message)});
 const cancel=useMutation({mutationFn:async(goalId:string)=>{const {error}=await supabase.rpc('cancel_approved_goal',{p_goal_id:goalId,p_reason:'בוטל ממסך המשחק'});if(error)throw error},onSuccess:()=>{toast.success('השער בוטל ונשמר בהיסטוריה');refresh()},onError:(e:any)=>toast.error(e.message)});
 const markAll=useMutation({mutationFn:async()=>{const {error}=await supabase.rpc('set_match_attendance',{p_match_id:match.id,p_user_id:null,p_attended:true});if(error)throw error},onSuccess:()=>{toast.success('כל הרשומים סומנו כנוכחים. אפשר לדווח שערים');refresh()},onError:(e:any)=>toast.error(e.message)});

 const events=data?.events||[];
 const approved=events.filter(e=>e.status==='approved');
 const pending=events.filter(e=>e.status==='pending');
 const scores=useMemo(()=>{
  const byPlayer=new Map<string,{userId:string;name:string;goals:number}>();
  approved.forEach(e=>{const current=byPlayer.get(e.scorer_user_id);if(current)current.goals++;else byPlayer.set(e.scorer_user_id,{userId:e.scorer_user_id,name:goalName(e.scorer),goals:1})});
  return[...byPlayer.values()].sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name,'he'));
 },[approved]);
 const leaders=scores.length?scores.filter(x=>x.goals===scores[0].goals):[];
 const showForm=participants.length>0&&((Boolean(data?.reportingOpen)&&mine)||(canManageGoals&&started));

 return <Card className="space-y-4">
  <div className="section-title"><div><h2><Goal size={20}/>שערים במשחק</h2><p className="section-help">הרשמה ונוכחות הן פעולות נפרדות. רק מי שסומן כנוכח יכול לדווח או להיבחר כמבקיע.</p></div><Badge>{approved.length} שערים מאושרים</Badge></div>

  {scores.length?<div className="players-grid">{scores.map(row=><div className="player-row" key={row.userId}><div className="player-avatar sm">{row.name[0]||'ש'}</div><span>{row.name}</span><strong className="ms-auto">{row.goals}</strong></div>)}</div>:<p className="empty-inline">עדיין אין שערים מאושרים במשחק.</p>}
  {leaders.length>0&&<div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3"><strong className="flex items-center gap-2"><Crown size={18}/>מלך השערים של המשחק</strong><p className="mt-1">{leaders.map(x=>`${x.name} — ${x.goals}`).join(' · ')}</p></div>}

  {isLoading&&<div className="empty-inline">בודקים אם דיווח השערים פתוח...</div>}
  {error&&<div className="empty-inline">לא הצלחנו לטעון כרגע את דיווחי השערים. נסה לרענן.</div>}
  {!isLoading&&!started&&<div className="rounded-xl border border-sky-400/25 bg-sky-400/10 p-3"><strong className="flex items-center gap-2"><Clock3 size={18}/>דיווח השערים עדיין לא נפתח</strong><p className="mt-1">הדיווח ייפתח אוטומטית בתחילת המשחק: {startAt.toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}.</p></div>}
  {started&&confirmed.length===0&&<div className="empty-inline">אין עדיין שחקנים רשומים למשחק. יש להירשם דרך הכפתור „אני מגיע”.</div>}
  {started&&confirmed.length>0&&participants.length===0&&<div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-3"><strong className="flex items-center gap-2"><UserCheck size={18}/>נדרש סימון נוכחות</strong><p className="mt-1">השחקנים רשומים, אבל עדיין לא סומנו כמי שהשתתפו בפועל.</p>{canManageAttendance?<Button className="mt-3" disabled={markAll.isPending} onClick={()=>markAll.mutate()}><UserCheck size={17}/>סימון כל הרשומים כנוכחים</Button>:<p className="section-help mt-2">מנהל המשחק צריך לסמן נוכחות כדי לפתוח את דיווח השערים.</p>}</div>}
  {started&&participants.length>0&&registered&&!mine&&<div className="empty-inline">אתה רשום למשחק, אך עדיין לא סומנת כנוכח. פנה למנהל המשחק.</div>}
  {started&&participants.length>0&&!data?.reportingOpen&&!canManageGoals&&<div className="empty-inline">חלון דיווח השערים של השחקנים הסתיים. מנהל המשחק עדיין יכול לתקן את התוצאה.</div>}

  {showForm&&<div className="rounded-xl border border-white/10 p-3"><label className="mb-2 block text-sm font-extrabold">מי הבקיע?</label><div className="flex flex-col gap-2 sm:flex-row"><Select value={scorerId} onChange={e=>setScorer(e.target.value)}>{participants.map(p=><option key={p.user_id} value={p.user_id}>{fullName(p.profiles)}</option>)}</Select>{data?.reportingOpen&&mine&&<Button disabled={!scorerId||report.isPending||addDirect.isPending} onClick={()=>report.mutate()}><Goal size={17}/>דיווח גול לאישור</Button>}{canManageGoals&&started&&<Button variant="secondary" disabled={!scorerId||report.isPending||addDirect.isPending} onClick={()=>addDirect.mutate()}><ShieldCheck size={17}/>הוספת שער מאושר</Button>}</div>{data?.reportingOpen&&mine&&<p className="section-help mt-2">דיווח של שחקן ייכנס לסטטיסטיקה רק לאחר אישור מנהל המשחק.</p>}</div>}

  {canManageGoals&&<div className="space-y-3 border-t border-white/10 pt-4"><div className="section-title"><h3 className="font-extrabold">דיווחים שממתינים לאישור</h3><Badge>{pending.length}</Badge></div>{pending.length?pending.map(e=><div className="player-row" key={e.id}><div><strong>{goalName(e.scorer)}</strong><small className="block opacity-70">דווח על ידי {goalName(e.reporter)}</small></div><div className="ms-auto flex gap-2">{e.reported_by!==user?.id&&<Button className="!px-3 !py-2" disabled={review.isPending} onClick={()=>review.mutate({goalId:e.id,approve:true})}><Check size={16}/>אישור</Button>}<Button className="!px-3 !py-2" variant="danger" disabled={review.isPending} onClick={()=>review.mutate({goalId:e.id,approve:false})}><CircleX size={16}/>דחייה</Button></div></div>):<p className="empty-inline">אין דיווחים שממתינים לטיפול.</p>}
   {approved.length>0&&<details><summary className="cursor-pointer font-extrabold">תיקון שערים מאושרים ({approved.length})</summary><div className="mt-2 space-y-2">{approved.map(e=><div className="player-row" key={e.id}><span>{goalName(e.scorer)}</span><Button className="ms-auto !px-3 !py-2" variant="danger" disabled={cancel.isPending} onClick={()=>confirm(`לבטל את השער של ${goalName(e.scorer)}? האירוע יישמר בהיסטוריה.`)&&cancel.mutate(e.id)}><Trash2 size={15}/>ביטול</Button></div>)}</div></details>}
  </div>}
 </Card>;
}

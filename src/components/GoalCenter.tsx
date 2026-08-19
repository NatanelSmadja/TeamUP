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
 const canEditAttendance=canManageAttendance&&!match.ratings_open&&match.status!=='completed';
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

 return <Card className="goal-center-card">
  <header className="goal-center-head">
   <div className="goal-center-title"><span><Goal size={21}/></span><div><small>MATCH SCORE</small><h2>שערים במשחק</h2><p>רק שחקן שסומן כנוכח יכול לדווח או להיבחר כמבקיע.</p></div></div>
   <Badge>{approved.length} שערים מאושרים</Badge>
  </header>

  {scores.length?<div className="goal-scoreboard">{scores.map((row,index)=><div className="goal-score-row" key={row.userId}><b>{index+1}</b><div className="player-avatar sm">{row.name[0]||'ש'}</div><span>{row.name}</span><strong>{row.goals}</strong></div>)}</div>:<div className="goal-empty"><Goal size={24}/><div><strong>עדיין אין שערים</strong><span>שערים מאושרים יוצגו כאן בזמן אמת.</span></div></div>}
  {leaders.length>0&&<div className="goal-leader"><Crown size={19}/><div><strong>מלך השערים של המשחק</strong><p>{leaders.map(x=>`${x.name} — ${x.goals}`).join(' · ')}</p></div></div>}

  {isLoading&&<div className="goal-notice">בודקים אם דיווח השערים פתוח...</div>}
  {error&&<div className="goal-notice danger">לא הצלחנו לטעון כרגע את דיווחי השערים. נסה לרענן.</div>}
  {!isLoading&&!started&&<div className="goal-notice info"><Clock3 size={19}/><div><strong>דיווח השערים עדיין לא נפתח</strong><p>הדיווח ייפתח אוטומטית בתחילת המשחק: {startAt.toLocaleString('he-IL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}.</p></div></div>}
  {started&&confirmed.length===0&&<div className="goal-notice">אין עדיין שחקנים רשומים למשחק.</div>}
  {started&&confirmed.length>0&&participants.length===0&&<div className="goal-notice warning"><UserCheck size={19}/><div><strong>נדרש סימון נוכחות</strong><p>השחקנים רשומים, אבל עדיין לא סומנו כמי שהשתתפו בפועל.</p>{canEditAttendance?<Button disabled={markAll.isPending} onClick={()=>markAll.mutate()}><UserCheck size={17}/>סימון כל הרשומים כנוכחים</Button>:<span>מנהל המשחק צריך לסמן נוכחות לפני סיום המשחק.</span>}</div></div>}
  {started&&participants.length>0&&registered&&!mine&&<div className="goal-notice warning">אתה רשום למשחק, אך עדיין לא סומנת כנוכח. פנה למנהל המשחק.</div>}
  {started&&participants.length>0&&!data?.reportingOpen&&!canManageGoals&&<div className="goal-notice">חלון הדיווח של השחקנים הסתיים. מנהל המשחק עדיין יכול לתקן את התוצאה.</div>}

  {showForm&&<section className="goal-report-form"><div><strong>הוספת שער</strong><p>{canManageGoals?'בחר מבקיע והוסף שער מאושר לתוצאה.':'בחר מי הבקיע ושלח את הדיווח לאישור מנהל.'}</p></div><div className="goal-report-controls"><Select value={scorerId} onChange={e=>setScorer(e.target.value)} aria-label="בחירת מבקיע">{participants.map(p=><option key={p.user_id} value={p.user_id}>{fullName(p.profiles)}</option>)}</Select>{data?.reportingOpen&&mine&&<Button disabled={!scorerId||report.isPending||addDirect.isPending} onClick={()=>report.mutate()}><Goal size={17}/>דיווח לאישור</Button>}{canManageGoals&&started&&<Button variant="secondary" disabled={!scorerId||report.isPending||addDirect.isPending} onClick={()=>addDirect.mutate()}><ShieldCheck size={17}/>הוספת שער מאושר</Button>}</div></section>}

  {canManageGoals&&<section className="goal-review-section"><div className="section-title"><div><h3>דיווחים שממתינים לאישור</h3><p>אישור יעדכן מיד את התוצאה והסטטיסטיקות.</p></div><Badge>{pending.length}</Badge></div>{pending.length?<div className="goal-review-list">{pending.map(e=><div className="goal-review-row" key={e.id}><div><strong>{goalName(e.scorer)}</strong><small>דווח על ידי {goalName(e.reporter)}</small></div><div><Button disabled={review.isPending} onClick={()=>review.mutate({goalId:e.id,approve:true})}><Check size={16}/>אישור</Button><Button variant="danger" disabled={review.isPending} onClick={()=>review.mutate({goalId:e.id,approve:false})}><CircleX size={16}/>דחייה</Button></div></div>)}</div>:<p className="empty-inline">אין דיווחים שממתינים לטיפול.</p>}
   {approved.length>0&&<details className="goal-corrections"><summary>תיקון שערים מאושרים ({approved.length})</summary><div>{approved.map(e=><div className="goal-correction-row" key={e.id}><span>{goalName(e.scorer)}</span><Button variant="danger" disabled={cancel.isPending} onClick={()=>confirm(`לבטל את השער של ${goalName(e.scorer)}? האירוע יישמר בהיסטוריה.`)&&cancel.mutate(e.id)}><Trash2 size={15}/>ביטול שער</Button></div>)}</div></details>}
  </section>}
 </Card>;
}

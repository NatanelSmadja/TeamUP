import {useEffect,useMemo} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams} from 'react-router-dom';
import {CalendarCheck,Check,Share2,Users,UserX,Clock3,ChevronDown,Lock} from 'lucide-react';
import {Badge,Button,Card,Tooltip} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {toast} from 'sonner';
import {fullName} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

const dayNames=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const formatWeek=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});

export default function AvailabilityPage(){
 const {user}=useAuth();
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const [params,setParams]=useSearchParams();
 const selectedFromUrl=params.get('poll');
 const pollsKey=['weekly-polls',g?.group.id] as const;
 const {data:polls=[],isLoading:pollsLoading}=useQuery({queryKey:pollsKey,enabled:!!g,queryFn:async()=>{
  const {data,error}=await supabase.from('weekly_polls').select('*').eq('group_id',g!.group.id).order('week_start',{ascending:false}).order('created_at',{ascending:false}).limit(20);
  if(error)throw error;return data||[];
 }});
 const selectedPoll=useMemo(()=>polls.find((p:any)=>p.id===selectedFromUrl)||polls.find((p:any)=>p.status==='open')||polls[0]||null,[polls,selectedFromUrl]);
 useEffect(()=>{if(selectedPoll&&selectedPoll.id!==selectedFromUrl)setParams({poll:selectedPoll.id},{replace:true})},[selectedPoll?.id]);
 const key=['weekly-poll-detail',selectedPoll?.id] as const;
 const {data,isLoading}=useQuery({queryKey:key,enabled:!!selectedPoll&&!!g,queryFn:async()=>{
  const [{data:votes,error:ve},{data:responses,error:re},{data:members,error:me}]=await Promise.all([
   supabase.from('availability_votes').select('*,profiles(first_name,last_name)').eq('poll_id',selectedPoll!.id).order('created_at'),
   supabase.from('weekly_poll_responses').select('*,profiles(first_name,last_name)').eq('poll_id',selectedPoll!.id).order('created_at'),
   supabase.from('group_members').select('user_id,profiles(first_name,last_name)').eq('group_id',g!.group.id).eq('status','active')
  ]);
  if(ve)throw ve;if(re)throw re;if(me)throw me;
  return {poll:selectedPoll,votes:votes||[],responses:responses||[],members:members||[]};
 }});
 useRealtimeInvalidation(`poll-list-${g?.group.id}`,['weekly_polls'],[pollsKey],!!g);
 useRealtimeInvalidation(`poll-detail-${selectedPoll?.id}`,['availability_votes','weekly_poll_responses'],[key],!!selectedPoll);
 const mine=useMemo(()=>new Set((data?.votes||[]).filter((v:any)=>v.user_id===user?.id).map((v:any)=>v.day_of_week)),[data,user]);
 const unavailable=!!data?.responses?.some((r:any)=>r.user_id===user?.id&&r.response==='unavailable');
 const respondedIds=useMemo(()=>new Set([...(data?.votes||[]).map((v:any)=>v.user_id),...(data?.responses||[]).map((r:any)=>r.user_id)]),[data]);
 const pending=(data?.members||[]).filter((m:any)=>!respondedIds.has(m.user_id));
 const bestDay=dayNames.map((name,i)=>({name,count:(data?.votes||[]).filter((v:any)=>v.day_of_week===i).length})).sort((a,b)=>b.count-a.count)[0];
 const toggle=useMutation({mutationFn:async({day,isUnavailable}:{day:number|null;isUnavailable:boolean})=>{
  if(!data)throw new Error('אין סקר נבחר');
  if(data.poll.status!=='open')throw new Error('הסקר סגור להצבעה');
  const {error}=await supabase.rpc('toggle_weekly_availability',{p_poll_id:data.poll.id,p_day:day,p_unavailable:isUnavailable});if(error)throw error;
 },onSuccess:()=>qc.invalidateQueries({queryKey:key}),onError:(e:any)=>toast.error(e.message)});
 const share=async()=>{if(!data)return;const lines=dayNames.map((name,i)=>`${name}: ${(data.votes||[]).filter((v:any)=>v.day_of_week===i).length}`).join('\n');const text=`TEAMUP · ${data.poll.title||'סקר זמינות'}\nשבוע: ${formatWeek(data.poll.week_start)}\n${lines}\nלא יכולים: ${data.responses.length}\nממתינים לתשובה: ${pending.length}`;try{if(navigator.share)await navigator.share({title:data.poll.title||'סקר TEAMUP',text});else{await navigator.clipboard.writeText(text);toast.success('סיכום הסקר הועתק')}}catch{}};
 return <div className="space-y-5">
  <div className="page-heading"><div><p>אפשר לפתוח כמה סקרים גם באותו שבוע</p><h1>סקרי זמינות</h1></div><Badge>מתעדכן בלייב</Badge></div>
  {pollsLoading&&<Card>טוען סקרים...</Card>}
  {!pollsLoading&&!polls.length&&<Card className="empty-state"><CalendarCheck size={34}/><h2>אין עדיין סקרים</h2><p>מנהל הקבוצה יכול לפתוח סקר חדש ממרכז הניהול.</p></Card>}
  {!!polls.length&&<Card className="poll-switcher"><div><small>הסקר שמוצג עכשיו</small><strong>{selectedPoll?.title||'סקר זמינות'}</strong></div><div className="poll-select-wrap"><ChevronDown size={17}/><select value={selectedPoll?.id||''} onChange={e=>setParams({poll:e.target.value})}>{polls.map((p:any)=><option key={p.id} value={p.id}>{p.title||'סקר זמינות'} · {formatWeek(p.week_start)} · {p.status==='open'?'פתוח':'סגור'}</option>)}</select></div></Card>}
  {isLoading&&<Card>טוען את ההצבעות...</Card>}
  {data&&<>
   <Card className="hero-card poll-summary-card"><div><p className="eyebrow">{data.poll.status==='open'?'הצבעה פתוחה':'הסקר נסגר'}</p><h2>{data.poll.title||'סקר זמינות'}</h2><p>שבוע שמתחיל ב־{formatWeek(data.poll.week_start)}. כל סקר נשמר בנפרד, גם כשיש שני משחקים באותו שבוע.</p></div><div className="action-row"><Badge>{data.poll.status==='open'?'פתוח':'סגור'}</Badge><Button variant="secondary" onClick={share}><Share2 size={17}/>שיתוף סיכום</Button></div></Card>
   <div className="poll-insights"><Card><CalendarCheck/><strong>{bestDay?.count||0}</strong><span>הכי הרבה ביום {bestDay?.name}</span></Card><Card><UserX/><strong>{data.responses.length}</strong><span>לא יכולים</span></Card><Card><Clock3/><strong>{pending.length}</strong><span>ממתינים לתשובה</span></Card></div>
   {data.poll.status!=='open'&&<div className="privacy-banner"><Lock/><div><strong>הסקר סגור</strong><p>אפשר לצפות בתוצאות, אך לא לשנות הצבעה. מנהל יכול לפתוח אותו מחדש.</p></div></div>}
   <Card className={`unavailable-card ${unavailable?'selected':''}`}><button disabled={toggle.isPending||data.poll.status!=='open'} onClick={()=>toggle.mutate({day:null,isUnavailable:true})} className="poll-toggle" title="מסמן שענית לסקר אבל אינך יכול להגיע"><div className="poll-day-icon">{unavailable?<Check size={21}/>:<UserX size={21}/>}</div><div><small>תשובה לסקר</small><h2>לא יכול</h2></div><Badge>{data.responses.length} שחקנים</Badge></button><div className="voter-list"><div className="voter-title"><Users size={16}/>מי לא יכול?</div>{data.responses.length?data.responses.map((r:any)=><span key={r.id} className="person-chip">{fullName(r.profiles)}</span>):<span className="empty-inline">אף אחד עדיין</span>}</div></Card>
   <div className="poll-grid">{dayNames.map((name,i)=>{const selected=mine.has(i);const voters=(data.votes||[]).filter((v:any)=>v.day_of_week===i);return <Card key={name} className={`poll-card ${selected?'selected':''}`}><button disabled={toggle.isPending||data.poll.status!=='open'} onClick={()=>toggle.mutate({day:i,isUnavailable:false})} className="poll-toggle"><div className="poll-day-icon">{selected?<Check size={21}/>:i+1}</div><div><small>יום</small><h2>{name}</h2></div><Badge>{voters.length} זמינים</Badge></button><div className="voter-list"><div className="voter-title"><Users size={16}/>מי הצביע?</div>{voters.length?voters.map((v:any)=><Tooltip key={v.id} label={`זמין ביום ${name}`}><span className="person-chip">{fullName(v.profiles)}</span></Tooltip>):<span className="empty-inline">עדיין אף אחד</span>}</div></Card>})}</div>
   {pending.length>0&&<Card><div className="section-title"><h2><Clock3 size={19}/>ממתינים לתשובה</h2><Badge>{pending.length}</Badge></div><div className="voter-list mt-4">{pending.map((m:any)=><span key={m.user_id} className="person-chip pending-chip">{fullName(m.profiles)}</span>)}</div></Card>}
  </>}
 </div>;
}

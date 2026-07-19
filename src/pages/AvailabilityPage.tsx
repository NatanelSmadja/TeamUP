import {useMemo} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {CalendarCheck,Check,Share2,Users,UserX,Clock3} from 'lucide-react';
import {Badge,Button,Card,Tooltip} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {toast} from 'sonner';
import {fullName} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

const dayNames=['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

export default function AvailabilityPage(){
 const {user}=useAuth();
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const key=['weekly-poll',g?.group.id] as const;
 const {data,isLoading}=useQuery({queryKey:key,enabled:!!g,queryFn:async()=>{
  const {data:poll,error}=await supabase.from('weekly_polls').select('*').eq('group_id',g!.group.id).eq('status','open').order('week_start',{ascending:false}).limit(1).maybeSingle();
  if(error)throw error;if(!poll)return null;
  const [{data:votes,error:ve},{data:responses,error:re},{data:members,error:me}]=await Promise.all([
   supabase.from('availability_votes').select('*,profiles(first_name,last_name)').eq('poll_id',poll.id).order('created_at'),
   supabase.from('weekly_poll_responses').select('*,profiles(first_name,last_name)').eq('poll_id',poll.id).order('created_at'),
   supabase.from('group_members').select('user_id,profiles(first_name,last_name)').eq('group_id',g!.group.id).eq('status','active')
  ]);
  if(ve)throw ve;if(re)throw re;if(me)throw me;
  return {poll,votes:votes||[],responses:responses||[],members:members||[]};
 }});
 useRealtimeInvalidation(`poll-${g?.group.id}`,['weekly_polls','availability_votes','weekly_poll_responses'],[key],!!g);
 const mine=useMemo(()=>new Set((data?.votes||[]).filter((v:any)=>v.user_id===user?.id).map((v:any)=>v.day_of_week)),[data,user]);
 const unavailable=!!data?.responses?.some((r:any)=>r.user_id===user?.id&&r.response==='unavailable');
 const respondedIds=useMemo(()=>new Set([...(data?.votes||[]).map((v:any)=>v.user_id),...(data?.responses||[]).map((r:any)=>r.user_id)]),[data]);
 const pending=(data?.members||[]).filter((m:any)=>!respondedIds.has(m.user_id));
 const bestDay=dayNames.map((name,i)=>({name,count:(data?.votes||[]).filter((v:any)=>v.day_of_week===i).length})).sort((a,b)=>b.count-a.count)[0];

 const toggle=useMutation({mutationFn:async({day,isUnavailable}:{day:number|null;isUnavailable:boolean})=>{
  if(!data)throw new Error('אין סקר פתוח');
  const {error}=await supabase.rpc('toggle_weekly_availability',{p_poll_id:data.poll.id,p_day:day,p_unavailable:isUnavailable});
  if(error)throw error;
 },onSuccess:()=>qc.invalidateQueries({queryKey:key}),onError:(e:any)=>toast.error(e.message)});

 const share=async()=>{
  if(!data)return;
  const lines=dayNames.map((name,i)=>`${name}: ${(data.votes||[]).filter((v:any)=>v.day_of_week===i).length}`).join('\n');
  const text=`TEAMUP · סקר שבועי\n${lines}\nלא יכולים השבוע: ${data.responses.length}\nממתינים לתשובה: ${pending.length}`;
  try{if(navigator.share)await navigator.share({title:'סקר שבועי TEAMUP',text});else{await navigator.clipboard.writeText(text);toast.success('סיכום הסקר הועתק')}}catch{}
 };

 return <div className="space-y-5">
  <div className="page-heading"><div><p>הזמינות של כל הקבוצה במקום אחד</p><h1>סקר שבועי</h1></div><Badge>מתעדכן בלייב</Badge></div>
  {isLoading&&<Card>טוען את הסקר...</Card>}
  {!isLoading&&!data&&<Card className="empty-state"><CalendarCheck size={34}/><h2>אין כרגע סקר פתוח</h2><p>מנהל הקבוצה יפתח סקר חדש לימים ראשון עד שבת.</p></Card>}
  {data&&<>
   <Card className="hero-card poll-summary-card"><div><p className="eyebrow">השבוע הנוכחי</p><h2>שבוע שמתחיל ב־{data.poll.week_start}</h2><p>בחירת יום או “לא יכול השבוע” נחשבת תשובה מלאה. כך המנהל יודע שלא התעלמת מהסקר.</p></div><Button variant="secondary" onClick={share}><Share2 size={17}/>שיתוף סיכום</Button></Card>
   <div className="poll-insights">
    <Card><CalendarCheck/><strong>{bestDay?.count||0}</strong><span>הכי הרבה ביום {bestDay?.name}</span></Card>
    <Card><UserX/><strong>{data.responses.length}</strong><span>לא יכולים השבוע</span></Card>
    <Card><Clock3/><strong>{pending.length}</strong><span>ממתינים לתשובה</span></Card>
   </div>
   <Card className={`unavailable-card ${unavailable?'selected':''}`}>
    <button disabled={toggle.isPending} onClick={()=>toggle.mutate({day:null,isUnavailable:true})} className="poll-toggle" title="מסמן שענית לסקר אבל אינך יכול להגיע באף יום השבוע">
     <div className="poll-day-icon">{unavailable?<Check size={21}/>:<UserX size={21}/>}</div><div><small>תשובה לשבוע</small><h2>לא יכול השבוע</h2></div><Badge>{data.responses.length} שחקנים</Badge>
    </button>
    <div className="voter-list"><div className="voter-title"><Users size={16}/>מי לא יכול השבוע?</div>{data.responses.length?data.responses.map((r:any)=><span key={r.id} className="person-chip">{fullName(r.profiles)}</span>):<span className="empty-inline">אף אחד עדיין</span>}</div>
   </Card>
   <div className="poll-grid">{dayNames.map((name,i)=>{const selected=mine.has(i);const voters=(data.votes||[]).filter((v:any)=>v.day_of_week===i);return <Card key={name} className={`poll-card ${selected?'selected':''}`}><button disabled={toggle.isPending} onClick={()=>toggle.mutate({day:i,isUnavailable:false})} title={selected?'ביטול הבחירה ביום זה':'סימון שאני זמין ביום זה'} className="poll-toggle"><div className="poll-day-icon">{selected?<Check size={21}/>:i+1}</div><div><small>יום</small><h2>{name}</h2></div><Badge>{voters.length} זמינים</Badge></button><div className="voter-list"><div className="voter-title"><Users size={16}/>מי הצביע?</div>{voters.length?voters.map((v:any)=><Tooltip key={v.id} label={`סימן שהוא זמין ביום ${name}`}><span className="person-chip">{fullName(v.profiles)}</span></Tooltip>):<span className="empty-inline">עדיין אף אחד</span>}</div></Card>})}</div>
   {pending.length>0&&<Card><div className="section-title"><h2><Clock3 size={19}/>ממתינים לתשובה</h2><Badge>{pending.length}</Badge></div><div className="voter-list mt-4">{pending.map((m:any)=><span key={m.user_id} className="person-chip pending-chip">{fullName(m.profiles)}</span>)}</div></Card>}
   <Button className="w-full md:w-auto" title="הבחירות נשמרות אוטומטית" onClick={()=>toast.success(unavailable||mine.size?'התשובה שלך שמורה':'עדיין לא בחרת תשובה')}>סיימתי לבחור</Button>
  </>}
 </div>;
}

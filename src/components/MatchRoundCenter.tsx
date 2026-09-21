import {useMemo,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Minus,Plus,ShieldCheck,Trophy} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '../contexts/AuthContext';
import {canManage,useGroup} from '../hooks/useGroup';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import {fullName} from '../lib/utils';
import type {Match,Registration} from '../types';
import {Badge,Button,Card,Select} from './ui';

type MatchTeam={
 id:string;name:string;color_key?:string;
 team_players?:Array<{
  user_id?:string|null;guest_id?:string|null;
  profiles?:{first_name?:string;last_name?:string};
  guest?:{display_name?:string;attended?:boolean}|null;
 }>;
};
type TeamWinEvent={id:string;team_id:string;created_at:string};
type CleanSheetEvent={
 id:string;goalkeeper_user_id?:string|null;goalkeeper_guest_id?:string|null;team_id:string;created_at:string;
 goalkeeper?:{first_name?:string;last_name?:string};
 guest?:{display_name?:string};
};

const colorNames:Record<string,string>={red:'אדומים',blue:'כחולים',yellow:'צהובים',green:'ירוקים'};
const colorIcons:Record<string,string>={red:'🔴',blue:'🔵',yellow:'🟡',green:'🟢'};
const requestId=()=>typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16)});
const teamName=(team:MatchTeam)=>colorNames[team.color_key||'']||team.name;

export function MatchRoundCenter({match,registrations,teams}:{match:Match;registrations:Registration[];teams:MatchTeam[]}){
 const {user}=useAuth();
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const [goalkeeper,setGoalkeeper]=useState('');
 const key=['match-round-results',match.id] as const;
 const canManageResults=match.created_by===user?.id||canManage(g,'enter_results');
 const started=Date.now()>=new Date(`${match.match_date}T${match.start_time}`).getTime();

 const {data,isLoading,error}=useQuery({
  queryKey:key,
  refetchInterval:30000,
  queryFn:async()=>{
   const [{data:wins,error:winsError},{data:cleanSheets,error:cleanError}]=await Promise.all([
    supabase.from('match_team_win_events').select('id,team_id,created_at').eq('match_id',match.id).is('cancelled_at',null).order('created_at',{ascending:false}),
    supabase.from('match_clean_sheet_events').select('id,goalkeeper_user_id,goalkeeper_guest_id,team_id,created_at,goalkeeper:profiles!match_clean_sheet_events_goalkeeper_user_id_fkey(first_name,last_name),guest:match_guests!match_clean_sheet_events_goalkeeper_guest_id_fkey(display_name)').eq('match_id',match.id).is('cancelled_at',null).order('created_at',{ascending:false}),
   ]);
   if(winsError)throw winsError;
   if(cleanError)throw cleanError;
   return{wins:(wins||[]) as TeamWinEvent[],cleanSheets:(cleanSheets||[]) as unknown as CleanSheetEvent[]};
  },
 });
 useRealtimeInvalidation(`round-results-${match.id}`,['match_team_win_events','match_clean_sheet_events'],[key],true);

 const refresh=()=>qc.invalidateQueries({queryKey:key});
 const addWin=useMutation({
  mutationFn:async(teamId:string)=>{const {error}=await supabase.rpc('add_match_team_win',{p_match_id:match.id,p_team_id:teamId,p_client_request_id:requestId()});if(error)throw error},
  onSuccess:()=>{toast.success('נוסף ניצחון לקבוצה');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const removeWin=useMutation({
  mutationFn:async(eventId:string)=>{const {error}=await supabase.rpc('cancel_match_team_win',{p_event_id:eventId});if(error)throw error},
  onSuccess:()=>{toast.success('הניצחון האחרון בוטל');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const addCleanSheet=useMutation({
  mutationFn:async(participantId:string)=>{
   const [kind,id]=participantId.split(':');
   const {error}=await supabase.rpc('add_match_clean_sheet',{
    p_match_id:match.id,
    p_goalkeeper_user_id:kind==='user'?id:null,
    p_goalkeeper_guest_id:kind==='guest'?id:null,
    p_client_request_id:requestId(),
   });
   if(error)throw error;
  },
  onSuccess:()=>{toast.success('נוסף שער נקי לשוער');refresh()},onError:(e:any)=>toast.error(e.message),
 });
 const removeCleanSheet=useMutation({
  mutationFn:async(eventId:string)=>{const {error}=await supabase.rpc('cancel_match_clean_sheet',{p_event_id:eventId});if(error)throw error},
  onSuccess:()=>{toast.success('השער הנקי האחרון בוטל');refresh()},onError:(e:any)=>toast.error(e.message),
 });

 const wins=useMemo(()=>data?.wins||[],[data?.wins]);
 const cleanSheets=useMemo(()=>data?.cleanSheets||[],[data?.cleanSheets]);
 const winCounts=useMemo(()=>new Map(teams.map(team=>[team.id,wins.filter(event=>event.team_id===team.id).length])),[teams,wins]);
 const leadingWinCount=Math.max(0,...winCounts.values());
 const cleanSheetRows=useMemo(()=>{
  const rows=new Map<string,{participantId:string;name:string;teamId:string;count:number;latestId:string}>();
  cleanSheets.forEach(event=>{
   const participantId=event.goalkeeper_user_id?`user:${event.goalkeeper_user_id}`:`guest:${event.goalkeeper_guest_id}`;
   const current=rows.get(participantId);
   if(current)current.count++;
   else rows.set(participantId,{participantId,name:event.goalkeeper_user_id?fullName(event.goalkeeper as any):(event.guest?.display_name||'אורח'),teamId:event.team_id,count:1,latestId:event.id});
  });
  return[...rows.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'he'));
 },[cleanSheets]);
 const goalkeeperOptions=useMemo(()=>{
  const attendedUsers=new Set(registrations.filter(reg=>reg.registration_status==='confirmed'&&reg.attended).map(reg=>reg.user_id));
  return teams.flatMap(team=>(team.team_players||[]).flatMap(player=>{
   if(player.user_id&&attendedUsers.has(player.user_id))return[{id:`user:${player.user_id}`,name:fullName(player.profiles as any),team:teamName(team)}];
   if(player.guest_id&&player.guest?.attended)return[{id:`guest:${player.guest_id}`,name:player.guest.display_name||'אורח',team:teamName(team)}];
   return[];
  }));
 },[registrations,teams]);
 const selectedGoalkeeper=goalkeeper||goalkeeperOptions[0]?.id||'';
 const busy=addWin.isPending||removeWin.isPending||addCleanSheet.isPending||removeCleanSheet.isPending;
 const showCard=canManageResults||wins.length>0||cleanSheets.length>0;
 if(!teams.length||!showCard)return null;

 return <Card className="round-center-card">
  <header className="round-center-head">
   <div className="round-center-title"><span><Trophy size={21}/></span><div><small>MINI MATCHES</small><h2>ניצחונות ושערים נקיים</h2><p>תוצאות הסבבים של הערב בלבד. הנתונים אינם נכנסים לסטטיסטיקה המצטברת.</p></div></div>
   <Badge>{wins.length} ניצחונות נרשמו</Badge>
  </header>

  {error&&<div className="goal-notice danger">לא הצלחנו לטעון את תוצאות הסבבים. יש לוודא שמיגרציה 042 הותקנה.</div>}
  {isLoading&&<div className="goal-notice">טוען את תוצאות הסבבים...</div>}

  <section className="round-team-section">
   <div className="section-title"><div><h3>ניצחונות לקבוצות</h3><p>בסיום כל משחקון של 7 דקות מוסיפים ניצחון אחד לקבוצה המנצחת.</p></div></div>
   <div className="round-team-grid">{teams.map(team=>{
    const count=winCounts.get(team.id)||0;
    const latest=wins.find(event=>event.team_id===team.id);
    const leading=leadingWinCount>0&&count===leadingWinCount;
    return <article className={`round-team-card team-${team.color_key||'default'} ${leading?'is-leading':''}`} key={team.id}>
     <div><span className="round-team-icon">{colorIcons[team.color_key||'']||'⚽'}</span><strong>{teamName(team)}</strong>{leading&&<em>מובילה</em>}</div>
     <b>{count}</b><small>{count===1?'ניצחון':'ניצחונות'}</small>
     {canManageResults&&started&&match.status!=='cancelled'&&<div className="round-counter-actions">
      <Button variant="secondary" disabled={busy||!latest} title={`הפחתת ניצחון מ${teamName(team)}`} onClick={()=>latest&&removeWin.mutate(latest.id)}><Minus size={17}/></Button>
      <Button disabled={busy} title={`הוספת ניצחון ל${teamName(team)}`} onClick={()=>addWin.mutate(team.id)}><Plus size={17}/>ניצחון</Button>
     </div>}
    </article>})}</div>
  </section>

  <section className="clean-sheet-section">
   <div className="section-title"><div><h3><ShieldCheck size={18}/>שערים נקיים</h3><p>שוער שסיים משחקון בניצחון בלי לספוג מקבל ‎+1 לערב הזה.</p></div></div>
   {cleanSheetRows.length?<div className="clean-sheet-list">{cleanSheetRows.map(row=>{
    const team=teams.find(item=>item.id===row.teamId);
    return <div className="clean-sheet-row" key={row.participantId}>
     <div className="player-avatar sm">{row.name[0]||'ש'}</div>
     <span><strong>{row.name}</strong><small>{team?teamName(team):'קבוצה'}</small></span>
     <b>{row.count}</b>
     {canManageResults&&started&&match.status!=='cancelled'&&<Button variant="secondary" disabled={busy} title="ביטול השער הנקי האחרון" onClick={()=>removeCleanSheet.mutate(row.latestId)}><Minus size={16}/></Button>}
    </div>})}</div>:<div className="round-empty"><ShieldCheck size={22}/><span>עדיין לא סומנו שערים נקיים.</span></div>}
   {canManageResults&&started&&match.status!=='cancelled'&&<div className="clean-sheet-controls">
    <Select value={selectedGoalkeeper} onChange={event=>setGoalkeeper(event.target.value)} aria-label="בחירת שוער">
     {goalkeeperOptions.map(player=><option value={player.id} key={player.id}>{player.name} · {player.team}</option>)}
    </Select>
    <Button disabled={busy||!selectedGoalkeeper} onClick={()=>addCleanSheet.mutate(selectedGoalkeeper)}><Plus size={17}/>שער נקי</Button>
   </div>}
  </section>
 </Card>;
}

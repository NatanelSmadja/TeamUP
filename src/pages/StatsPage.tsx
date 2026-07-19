import {useQuery} from '@tanstack/react-query';
import {Award,CalendarDays,Crown,Flame,Medal,ShieldCheck,Sparkles,Star,Trophy,Users} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Badge,Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {fullName,profilePositionLabels} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

const achievementDefs=[
 {key:'first_match',title:'משחק ראשון',desc:'הופעה ראשונה ב־TEAMUP',icon:'⚽',test:(p:any)=>p.games>=1},
 {key:'ten_matches',title:'חבר קבוע',desc:'10 הופעות בקבוצה',icon:'🔟',test:(p:any)=>p.games>=10},
 {key:'twenty_five',title:'עמוד תווך',desc:'25 הופעות בקבוצה',icon:'🧱',test:(p:any)=>p.games>=25},
 {key:'first_mvp',title:'MVP ראשון',desc:'נבחר למצטיין המשחק',icon:'🏆',test:(p:any)=>p.mvp>=1},
 {key:'five_mvp',title:'כוכב הקבוצה',desc:'5 זכיות MVP',icon:'⭐',test:(p:any)=>p.mvp>=5},
 {key:'elite_rating',title:'רמת עילית',desc:'דירוג ממוצע 4.5 ומעלה',icon:'🔥',test:(p:any)=>p.rating>=4.5},
];

export default function StatsPage(){
 const {data:g}=useGroup();const key=['v2-stats',g?.group.id];
 const {data}=useQuery({queryKey:key,enabled:!!g,queryFn:async()=>{const [{data:members,error},{data:stats,error:se},{data:monthly,error:me}]=await Promise.all([supabase.from('group_members').select('user_id,profiles(*)').eq('group_id',g!.group.id).eq('status','active'),supabase.from('player_public_stats').select('*').eq('group_id',g!.group.id),supabase.rpc('get_player_of_month',{p_group_id:g!.group.id,p_month:new Date().toISOString().slice(0,10)})]);if(error)throw error;if(se)throw se;if(me)throw me;const map=new Map((stats||[]).map((x:any)=>[x.user_id,x]));const rows=(members||[]).map((m:any)=>{const st:any=map.get(m.user_id);return{id:m.user_id,profile:m.profiles,rating:Number(st?.avg_rating??m.profiles.base_rating??3),mvp:Number(st?.mvp_count||0),games:Number(st?.games_count||0)}}).sort((a,b)=>b.rating-a.rating);return{rows,monthly:monthly?.[0]||null}}});
 useRealtimeInvalidation(`v2stats-${g?.group.id}`,['player_public_stats','match_registrations','player_ratings','mvp_votes'],[key],!!g);
 const rows=data?.rows||[];const monthly:any=data?.monthly;const cards=[['הדירוג הגבוה',rows.slice().sort((a,b)=>b.rating-a.rating)[0],Star],['מלך ה־MVP',rows.slice().sort((a,b)=>b.mvp-a.mvp)[0],Crown],['מלך ההופעות',rows.slice().sort((a,b)=>b.games-a.games)[0],Flame]] as const;
 return <div className="space-y-6"><div className="page-heading"><div><p>המספרים שמספרים את הסיפור של הקבוצה</p><h1>סטטיסטיקות והיכל התהילה</h1></div></div>
 {monthly&&<Card className="player-of-month"><div className="month-crown"><Crown size={30}/></div><div><span><CalendarDays size={15}/>שחקן החודש</span><h2>{monthly.first_name} {monthly.last_name}</h2><p>נבחר לפי דירוגים, MVP והשתתפות בחודש הנוכחי</p></div><div className="month-score"><strong>{Math.round(Number(monthly.score))}</strong><span>נקודות</span></div></Card>}
 <div className="podium-grid">{cards.map(([title,p,Icon],i)=><Card key={title} className={`podium-card rank-${i+1}`}><Icon size={25}/><span>{title}</span><h2>{p?fullName(p.profile):'—'}</h2><strong>{p?(i===0?p.rating.toFixed(2):i===1?p.mvp:p.games):0}</strong></Card>)}</div>
 <Card><div className="section-title"><h2><Sparkles size={20}/>הישגי הקבוצה</h2><Badge>מתעדכן אוטומטית</Badge></div><div className="achievement-grid">{rows.flatMap(p=>achievementDefs.filter(a=>a.test(p)).map(a=>({player:p,a}))).slice(0,12).map(({player,a},i)=><Link to={`/players/${player.id}`} key={`${player.id}-${a.key}`} className="achievement-card"><div>{a.icon}</div><section><strong>{a.title}</strong><span>{fullName(player.profile)}</span><small>{a.desc}</small></section><ShieldCheck size={18}/></Link>)}</div>{!rows.some(p=>achievementDefs.some(a=>a.test(p)))&&<p className="empty-inline">ההישגים הראשונים ייפתחו אחרי המשחק הבא.</p>}</Card>
 <Card><div className="section-title"><h2><Trophy size={20}/>טבלת המובילים</h2><Badge>{rows.length} שחקנים</Badge></div><div className="leaderboard-table">{rows.map((p,i)=><Link to={`/players/${p.id}`} key={p.id} className="leader-row"><b>{i<3?[<Trophy/>,<Medal/>,<Award/>][i]:i+1}</b><div className="player-avatar">{p.profile?.first_name?.[0]||'ש'}</div><div><strong>{fullName(p.profile)}</strong><span>{profilePositionLabels(p.profile)}</span></div><div className="leader-stats"><span><Star size={14}/>{p.rating.toFixed(2)}</span><span><Crown size={14}/>{p.mvp}</span><span><Users size={14}/>{p.games}</span></div></Link>)}</div></Card></div>
}

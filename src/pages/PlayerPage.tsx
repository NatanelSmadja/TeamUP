import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,useParams} from 'react-router-dom';
import {ArrowRight,CalendarDays,Crown,Flame,Footprints,Goal,ImageDown,Star,Trophy} from 'lucide-react';
import {Badge,Button,Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {useAuth} from '../contexts/AuthContext';
import {supabase} from '../lib/supabase';
import {footLabel,fullName,positionLabel} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {PlayerBannerDialog} from '../components/PlayerBannerDialog';

export default function PlayerPage(){
 const {id}=useParams();const {user}=useAuth();const {data:g}=useGroup();
 const [bannerOpen,setBannerOpen]=useState(false);
 const {data,isLoading}=useQuery({queryKey:['player-card',id,g?.group.id],enabled:!!id&&!!g,queryFn:async()=>{
  const [{data:p,error},{data:st,error:se},{data:trend,error:te},{data:goalRows,error:ge}]=await Promise.all([
   supabase.from('profiles').select('*').eq('id',id).single(),
   supabase.from('player_public_stats').select('*').eq('group_id',g!.group.id).eq('user_id',id).maybeSingle(),
   supabase.rpc('get_player_rating_trend',{p_user_id:id,p_group_id:g!.group.id}),
   supabase.rpc('get_player_goal_stats',{p_user_id:id,p_group_id:g!.group.id,p_match_id:null})
  ]);
  if(error)throw error;if(se)throw se;if(te)throw te;if(ge)throw ge;const goals=goalRows?.[0];
  return{p,ratings:trend||[],mvp:Number(st?.mvp_count||0),games:Number(st?.games_count||0),avg:Number(st?.avg_rating??p.base_rating??3),ratingCount:Number(st?.rating_count||0),totalGoals:Number(goals?.total_goals||0),monthlyGoals:Number(goals?.monthly_goals||0),matchGoals:Number(goals?.current_match_goals||0)};
 }});
 useRealtimeInvalidation(`player-stats-${id}-${g?.group.id}`,['goal_events','player_public_stats','player_ratings','mvp_votes','match_registrations'],[['player-card',id,g?.group.id]],!!id&&!!g);
 if(isLoading)return <Card>טוען כרטיס שחקן...</Card>;if(!data)return <Card>השחקן לא נמצא.</Card>;
 const max=5;
 const name=fullName(data.p);const positions=(data.p.preferred_positions||[data.p.preferred_position]).filter(Boolean).map(positionLabel).join(' · ')||'שחקן';const overall=Math.max(20,Math.min(100,Math.round(data.avg*20)));
 return <div className="player-page"><div className="player-page-actions"><Link to={user?.id===id?'/profile':'/squad'} className="back-link"><ArrowRight size={17}/>{user?.id===id?'חזרה לפרופיל':'חזרה לקבוצה'}</Link><Button variant="secondary" onClick={()=>setBannerOpen(true)}><ImageDown size={17}/>ייצוא באנר</Button></div><Card className="player-card-hero"><div className="player-card-avatar">{data.p.first_name?.[0]}</div><div className="player-card-main"><Badge>TEAMUP PLAYER</Badge><h1>{name}</h1><p>{positions}</p><span>רגל {footLabel(data.p.preferred_foot)}</span></div><div className="overall"><small>OVERALL</small><strong>{overall}</strong><span>{data.avg.toFixed(2)}/5</span></div></Card><div className="player-stat-grid"><Card><Trophy/><strong>{data.games}</strong><span>משחקים</span></Card><Card><Crown/><strong>{data.mvp}</strong><span>זכיות MVP</span></Card><Card><Star/><strong>{data.avg.toFixed(2)}</strong><span>דירוג</span></Card><Card><Flame/><strong>{data.ratingCount}</strong><span>דירוגים שקיבל</span></Card></div><div className="player-stat-grid"><Card><Goal/><strong>{data.totalGoals}</strong><span>סה״כ שערים</span></Card><Card><CalendarDays/><strong>{data.monthlyGoals}</strong><span>שערים החודש</span></Card><Card><Goal/><strong>{data.matchGoals}</strong><span>במשחק הנוכחי</span></Card></div><Card><div className="section-title"><h2><Footprints size={20}/>מגמת דירוג אנונימית</h2></div><p className="empty-inline">כל עמודה היא ממוצע של משחק. זהות המדרגים לעולם אינה מוצגת.</p><div className="rating-chart">{data.ratings.slice(-12).map((r:any,i:number)=><div key={i} title={`${r.avg_rating}/5 · ${r.rating_count} דירוגים`}><i style={{height:`${Number(r.avg_rating)/max*100}%`}}/><span>{Number(r.avg_rating).toFixed(1)}</span></div>)}</div>{!data.ratings.length&&<p className="empty-inline">עדיין לא התקבלו דירוגים.</p>}</Card><PlayerBannerDialog open={bannerOpen} onClose={()=>setBannerOpen(false)} data={{name,position:positions,groupName:g?.group.name||'TEAMUP FC',overall,rating:data.avg,games:data.games,goals:data.totalGoals,mvp:data.mvp}}/></div>;
}

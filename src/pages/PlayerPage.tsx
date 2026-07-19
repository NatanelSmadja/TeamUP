import {useQuery} from '@tanstack/react-query';
import {Link,useParams} from 'react-router-dom';
import {ArrowRight,Crown,Flame,Footprints,Star,Trophy} from 'lucide-react';
import {Badge,Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {footLabel,fullName,profilePositionLabels} from '../lib/utils';

export default function PlayerPage(){
 const {id}=useParams();const {data:g}=useGroup();
 const {data,isLoading}=useQuery({queryKey:['player-card',id,g?.group.id],enabled:!!id&&!!g,queryFn:async()=>{
  const [{data:p,error},{data:st,error:se},{data:trend,error:te}]=await Promise.all([
   supabase.from('profiles').select('*').eq('id',id).single(),
   supabase.from('player_public_stats').select('*').eq('group_id',g!.group.id).eq('user_id',id).maybeSingle(),
   supabase.rpc('get_player_rating_trend',{p_user_id:id,p_group_id:g!.group.id})
  ]);
  if(error)throw error;if(se)throw se;if(te)throw te;
  return{p,ratings:trend||[],mvp:Number(st?.mvp_count||0),games:Number(st?.games_count||0),avg:Number(st?.avg_rating??p.base_rating??3),ratingCount:Number(st?.rating_count||0)};
 }});
 if(isLoading)return <Card>טוען כרטיס שחקן...</Card>;if(!data)return <Card>השחקן לא נמצא.</Card>;
 const max=5;
 return <div className="player-page"><Link to="/squad" className="back-link"><ArrowRight size={17}/>חזרה לקבוצה</Link><Card className="player-card-hero"><div className="player-card-avatar">{data.p.first_name?.[0]}</div><div className="player-card-main"><Badge>TEAMUP PLAYER</Badge><h1>{fullName(data.p)}</h1><p>{profilePositionLabels(data.p)}</p><span>רגל {footLabel(data.p.preferred_foot)}</span></div><div className="overall"><small>OVERALL</small><strong>{Math.round(data.avg*20)}</strong><span>{data.avg.toFixed(2)}/5</span></div></Card><div className="player-stat-grid"><Card><Trophy/><strong>{data.games}</strong><span>משחקים</span></Card><Card><Crown/><strong>{data.mvp}</strong><span>MVP</span></Card><Card><Star/><strong>{data.avg.toFixed(2)}</strong><span>דירוג</span></Card><Card><Flame/><strong>{data.ratingCount}</strong><span>דירוגים שקיבל</span></Card></div><Card><div className="section-title"><h2><Footprints size={20}/>מגמת דירוג אנונימית</h2></div><p className="empty-inline">כל עמודה היא ממוצע של משחק. זהות המדרגים לעולם אינה מוצגת.</p><div className="rating-chart">{data.ratings.slice(-12).map((r:any,i:number)=><div key={i} title={`${r.avg_rating}/5 · ${r.rating_count} דירוגים`}><i style={{height:`${Number(r.avg_rating)/max*100}%`}}/><span>{Number(r.avg_rating).toFixed(1)}</span></div>)}</div>{!data.ratings.length&&<p className="empty-inline">עדיין לא התקבלו דירוגים.</p>}</Card></div>;
}

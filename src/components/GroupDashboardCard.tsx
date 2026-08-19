import {useQuery} from '@tanstack/react-query';
import {CalendarCheck2,UserPlus,UsersRound} from 'lucide-react';
import {Card} from './ui';
import {supabase} from '../lib/supabase';
export default function GroupDashboardCard({groupId}:{groupId:string}){const q=useQuery({queryKey:['group-dashboard-summary',groupId],queryFn:async()=>{const {data,error}=await supabase.rpc('group_dashboard_summary',{p_group_id:groupId});if(error)throw error;return data as any},staleTime:30000});const d=q.data||{};return <div className="home-kpi-strip" aria-label="סיכום הקבוצה"><Card><span className="home-kpi-icon"><UsersRound/></span><div><strong>{d.members??'—'}</strong><span>שחקנים בקבוצה</span></div></Card><Card><span className="home-kpi-icon"><CalendarCheck2/></span><div><strong>{d.open_matches??'—'}</strong><span>משחקים פתוחים</span></div></Card><Card><span className="home-kpi-icon"><UserPlus/></span><div><strong>{d.pending_requests??'—'}</strong><span>ממתינים לאישור</span></div></Card></div>}

import {useQuery} from '@tanstack/react-query';
import {CalendarDays,UserPlus,UsersRound} from 'lucide-react';
import {Card} from './ui';
import {supabase} from '../lib/supabase';
export default function GroupDashboardCard({groupId}:{groupId:string}){const q=useQuery({queryKey:['group-dashboard-summary',groupId],queryFn:async()=>{const {data,error}=await supabase.rpc('group_dashboard_summary',{p_group_id:groupId});if(error)throw error;return data as any},staleTime:30000});const d=q.data||{};return <div className="mini-kpi-grid"><Card><UsersRound/><strong>{d.members??'—'}</strong><span>חברים</span></Card><Card><UserPlus/><strong>{d.pending_requests??'—'}</strong><span>בקשות</span></Card><Card><CalendarDays/><strong>{d.open_matches??'—'}</strong><span>הרשמות פתוחות</span></Card></div>}

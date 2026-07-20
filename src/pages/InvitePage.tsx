import {useEffect} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {useMutation,useQueryClient} from '@tanstack/react-query';
import {Card} from '../components/ui';
import {supabase} from '../lib/supabase';
import {toast} from 'sonner';

export default function InvitePage(){const {code}=useParams();const nav=useNavigate();const qc=useQueryClient();const join=useMutation({mutationFn:async()=>{const {data,error}=await supabase.rpc('join_group_by_invite',{p_code:code});if(error)throw error;return data as string},onSuccess:async id=>{await qc.invalidateQueries({queryKey:['my-groups']});localStorage.setItem('teamup_pending_group',id);toast.success('הצטרפת לקבוצה');nav('/groups',{replace:true})},onError:(e:any)=>{toast.error(e.message);setTimeout(()=>nav('/groups',{replace:true}),1800)}});useEffect(()=>{if(code&&!join.isPending&&!join.isSuccess&&!join.isError)join.mutate()},[code]);return <div className="groups-hub"><Card className="empty-state"><h2>מצרפים אותך לקבוצה</h2><p>המערכת בודקת את קישור ההזמנה...</p></Card></div>}

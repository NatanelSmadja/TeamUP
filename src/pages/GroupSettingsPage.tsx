import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,Settings,UserPlus,X} from 'lucide-react';
import {toast} from 'sonner';
import {Badge,Button,Card,FieldHelp,Input} from '../components/ui';
import {canManage,useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {fullName} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

type JoinRequest={request_id:string;user_id:string;first_name:string;last_name:string;preferred_position:string|null;preferred_positions:string[]|null;created_at:string};
export default function GroupSettingsPage(){
 const {data:g}=useGroup();
 const qc=useQueryClient();
 const [f,setF]=useState({name:'',description:'',default_location:''});
 const canManageMembers=canManage(g,'manage_members');
 useEffect(()=>{if(g)setF({name:g.group.name||'',description:g.group.description||'',default_location:g.group.default_location||''})},[g?.group.id]);
 const requestsKey=['join-requests',g?.group.id];
 const {data:requests=[],isLoading,error}=useQuery({queryKey:requestsKey,enabled:!!g&&canManageMembers,queryFn:async()=>{const {data,error}=await supabase.rpc('list_group_join_requests',{p_group_id:g!.group.id});if(error)throw error;return (data||[]) as JoinRequest[]}});
 useRealtimeInvalidation(`join-requests-${g?.group.id}`,['group_join_requests'],[requestsKey],!!g&&canManageMembers);
 const save=useMutation({mutationFn:async()=>{const {error}=await supabase.from('groups').update({name:f.name.trim(),description:f.description.trim()||null,default_location:f.default_location.trim()||null}).eq('id',g!.group.id);if(error)throw error},onSuccess:()=>{toast.success('פרטי הקבוצה עודכנו');qc.invalidateQueries({queryKey:['my-groups']});qc.invalidateQueries({queryKey:['group-catalog']})},onError:(e:any)=>toast.error(e.message)});
 const review=async(id:string,approve:boolean)=>{const {error}=await supabase.rpc('review_group_join_request',{p_request_id:id,p_approve:approve});if(error)toast.error(error.message);else{toast.success(approve?'השחקן צורף לקבוצה':'הבקשה נדחתה');await qc.invalidateQueries({queryKey:requestsKey});await qc.invalidateQueries({queryKey:['admin-members',g?.group.id]});await qc.invalidateQueries({queryKey:['group-catalog']})}};
 if(!canManage(g))return <Card>אין לך הרשאת ניהול לקבוצה הזאת.</Card>;
 return <div className="space-y-5"><div className="page-heading"><div><p>שם, תיאור ובקשות הצטרפות</p><h1>הגדרות הקבוצה</h1></div><Settings/></div><Card className="form-card"><div><h2>פרטי הקבוצה</h2><p>הפרטים האלה מוצגים למשתמשים שמחפשים קבוצה.</p></div><div className="form-grid"><div><FieldHelp title="שם הקבוצה">אפשר לשנות בלי לפגוע במשחקים ובהיסטוריה.</FieldHelp><Input value={f.name} onChange={e=>setF({...f,name:e.target.value})}/></div><div><FieldHelp title="מיקום קבוע">המגרש שבו אתם בדרך כלל משחקים.</FieldHelp><Input value={f.default_location} onChange={e=>setF({...f,default_location:e.target.value})}/></div><div className="md:col-span-2"><FieldHelp title="תיאור הקבוצה">מידע קצר עבור שחקנים שרוצים להצטרף.</FieldHelp><Input value={f.description} onChange={e=>setF({...f,description:e.target.value})}/></div></div><Button disabled={!f.name.trim()||save.isPending} onClick={()=>save.mutate()}>שמירת שינויים</Button></Card>{canManageMembers&&<Card><div className="section-title"><h2><UserPlus/>בקשות הצטרפות</h2><Badge>{requests.length}</Badge></div>{isLoading?<p className="empty-inline">טוען בקשות...</p>:error?<p className="empty-inline">לא הצלחנו לטעון בקשות: {error instanceof Error?error.message:'שגיאה לא ידועה'}</p>:<div className="join-request-list">{requests.map(r=><div key={r.request_id}><div className="player-avatar">{r.first_name?.[0]||'ש'}</div><div><strong>{fullName({first_name:r.first_name,last_name:r.last_name} as any)}</strong><span>{new Date(r.created_at).toLocaleDateString('he-IL')}</span></div><div><Button onClick={()=>review(r.request_id,true)}><Check size={16}/>אישור</Button><Button variant="danger" onClick={()=>review(r.request_id,false)}><X size={16}/>דחייה</Button></div></div>)}{!requests.length&&<p className="empty-inline">אין כרגע בקשות שממתינות לאישור.</p>}</div>}</Card>}</div>;
}

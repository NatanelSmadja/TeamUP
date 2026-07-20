import {useMemo,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {ChevronLeft,Clock3,MapPin,Plus,ShieldCheck,UsersRound,X} from 'lucide-react';
import {toast} from 'sonner';
import {Badge,Button,Card,FieldHelp,Input} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {useAuth} from '../contexts/AuthContext';

export default function GroupsPage(){
 const {profile,signOut}=useAuth();
 const groups=useGroup();
 const qc=useQueryClient();
 const navigate=useNavigate();
 const [open,setOpen]=useState(false);
 const [f,setF]=useState({name:'',description:'',default_location:'Gol Time'});
 const {data:catalog=[],isLoading,error}=useQuery({
  queryKey:['group-catalog',profile?.id],
  queryFn:async()=>{const {data,error}=await supabase.rpc('discover_groups');if(error)throw error;return data||[]}
 });
 const activeIds=useMemo(()=>new Set(groups.memberships.map(x=>x.group.id)),[groups.memberships]);
 const available=useMemo(()=>catalog.filter((g:any)=>!activeIds.has(g.group_id)),[catalog,activeIds]);
 const create=useMutation({mutationFn:async()=>{const {data,error}=await supabase.rpc('create_teamup_group',{p_name:f.name.trim(),p_description:f.description.trim()||null,p_location:f.default_location.trim()||null});if(error)throw error;return data as string},onSuccess:async id=>{toast.success('הקבוצה נוצרה ואתה המנהל שלה');setOpen(false);await qc.invalidateQueries();groups.setActiveGroupId(id);navigate('/')},onError:(e:any)=>toast.error(e.message)});
 const request=useMutation({mutationFn:async(id:string)=>{const {error}=await supabase.rpc('request_group_join',{p_group_id:id});if(error)throw error;return id},onSuccess:async()=>{toast.success('בקשת ההצטרפות נשלחה למנהל');await qc.invalidateQueries({queryKey:['group-catalog']})},onError:(e:any)=>toast.error(e.message)});
 const cancel=useMutation({mutationFn:async(id:string)=>{const {error}=await supabase.rpc('cancel_group_join_request',{p_group_id:id});if(error)throw error},onSuccess:async()=>{toast.success('בקשת ההצטרפות בוטלה');await qc.invalidateQueries({queryKey:['group-catalog']})},onError:(e:any)=>toast.error(e.message)});
 const enter=(id:string)=>{groups.setActiveGroupId(id);navigate('/')};
 return <div className="groups-hub"><header className="groups-hub-header"><div><span>⚽ TEAMUP</span><h1>הקבוצות שלך</h1><p>הצטרף לקבוצה קיימת או פתח קבוצה חדשה משלך.</p></div><div className="groups-user"><strong>{profile?.first_name||'שחקן'}</strong><button onClick={signOut}>יציאה</button></div></header>
  {!!groups.memberships.length&&<section><div className="section-title"><h2><ShieldCheck/>הקבוצות שלי</h2><Badge>{groups.memberships.length}</Badge></div><div className="group-card-grid">{groups.memberships.map(x=><Card key={x.group.id} className="group-discovery-card owned"><div className="group-logo">{x.group.name.slice(0,2)}</div><div><Badge>{x.member.role==='admin'?'מנהל קבוצה':x.member.role==='moderator'?'מנהל':'שחקן'}</Badge><h2>{x.group.name}</h2><p>{x.group.description||'קבוצת כדורגל ב־TEAMUP'}</p><span><MapPin size={14}/>{x.group.default_location||'מיקום לא הוגדר'}</span></div><Button onClick={()=>enter(x.group.id)}>כניסה <ChevronLeft size={17}/></Button></Card>)}</div></section>}
  <section><div className="section-title"><h2><UsersRound/>קבוצות שאפשר להצטרף אליהן</h2><Button onClick={()=>setOpen(v=>!v)}><Plus size={17}/>יצירת קבוצה</Button></div>{open&&<Card className="form-card group-create-card"><div><h2>פתיחת קבוצה חדשה</h2><p>מי שיוצר את הקבוצה הופך אוטומטית למנהל שלה.</p></div><div className="form-grid"><div><FieldHelp title="שם הקבוצה">שם שיופיע לחברים ובמסך החיפוש.</FieldHelp><Input value={f.name} onChange={e=>setF({...f,name:e.target.value})} placeholder="לדוגמה: כוכבי סטאר בול"/></div><div><FieldHelp title="מגרש קבוע">אפשר לשנות אחר כך.</FieldHelp><Input value={f.default_location} onChange={e=>setF({...f,default_location:e.target.value})}/></div><div className="md:col-span-2"><FieldHelp title="תיאור">מי אתם ומתי אתם משחקים.</FieldHelp><Input value={f.description} onChange={e=>setF({...f,description:e.target.value})}/></div></div><Button disabled={!f.name.trim()||create.isPending} onClick={()=>create.mutate()}>יצירת הקבוצה</Button></Card>}
   {isLoading?<Card>טוען קבוצות...</Card>:error?<Card className="empty-state"><h2>לא הצלחנו לטעון קבוצות</h2><p>{error instanceof Error?error.message:'נסה לרענן את העמוד'}</p></Card>:<div className="group-card-grid">{available.map((g:any)=>{const pending=g.request_status==='pending';return <Card key={g.group_id} className="group-discovery-card"><div className="group-logo">{g.group_name.slice(0,2)}</div><div><h2>{g.group_name}</h2><p>{g.description||'קבוצת כדורגל ב־TEAMUP'}</p><span><UsersRound size={14}/>{g.member_count} חברים</span>{g.default_location&&<span><MapPin size={14}/>{g.default_location}</span>}<small>מנהל: {g.owner_name||'מנהל הקבוצה'}</small></div>{pending?<div className="action-row"><Button variant="secondary" disabled><Clock3 size={17}/>ממתין לאישור</Button><Button variant="ghost" disabled={cancel.isPending} onClick={()=>cancel.mutate(g.group_id)}><X size={16}/>ביטול</Button></div>:<Button variant="secondary" disabled={request.isPending} onClick={()=>request.mutate(g.group_id)}>בקשת הצטרפות</Button>}</Card>})}{!available.length&&<Card className="empty-state"><UsersRound/><h2>אין קבוצות נוספות</h2><p>אתה כבר חבר בכל הקבוצות הזמינות, או שעדיין לא נפתחה קבוצה נוספת.</p></Card>}</div>}</section>
 </div>;
}

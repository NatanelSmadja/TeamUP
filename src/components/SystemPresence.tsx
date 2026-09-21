import {useQuery} from '@tanstack/react-query';
import {useAuth} from '../contexts/AuthContext';
import {isSystemAdmin} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {Card} from './ui';

type Presence = {online_count:number; recent_count:number; users:{user_id:string; first_name:string; last_name:string; last_seen_at:string; is_online:boolean}[]};

export default function SystemPresence() {
  const {profile, user} = useAuth();
  const allowed = isSystemAdmin(profile);
  const presence = useQuery({
    queryKey:['system-presence', user?.id], enabled:allowed, staleTime:0, gcTime:0,
    refetchInterval:30000, refetchOnWindowFocus:true,
    queryFn:async () => {
      const {data,error} = await supabase.rpc('system_admin_presence');
      if(error) throw error;
      return data as Presence;
    },
  });
  if(!allowed) return null;
  return <Card className="system-presence-panel">
    <div className="section-title"><h2>מחוברים עכשיו</h2><span>מתעדכן כל 30 שניות</span></div>
    {presence.isError ? <p role="alert">לא הצלחנו לעדכן את נתוני הפעילות. <button onClick={()=>void presence.refetch()}>נסה שוב</button></p>
      : presence.data ? <>
        <div className="system-presence-counts"><div><strong>{presence.data.online_count}</strong><span>מחוברים עכשיו</span></div><div><strong>{presence.data.recent_count}</strong><span>פעילים ב־5 הדקות האחרונות</span></div></div>
        <p>מחובר עכשיו הוא מי שהאפליקציה הייתה פתוחה אצלו ב־90 השניות האחרונות.</p>
        <details><summary>מי מחובר? ({presence.data.recent_count})</summary>
          <div className="system-presence-rows">{presence.data.users.map(person=><div className="system-presence-person" key={person.user_id}>
            <span className={person.is_online ? 'presence-live-dot' : 'presence-away-dot'}/>
            <strong>{`${person.first_name || ''} ${person.last_name || ''}`.trim() || 'משתמש ללא שם'}</strong>
            <time dateTime={person.last_seen_at}>{person.is_online ? 'מחובר עכשיו' : `נראה לאחרונה ב־${new Date(person.last_seen_at).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}`}</time>
          </div>)}</div>
          {!presence.data.users.length && <p>אין פעילות בחמש הדקות האחרונות.</p>}
          {presence.data.recent_count>presence.data.users.length && <p>מוצגים 200 המשתמשים האחרונים.</p>}
        </details>
      </> : <p>טוען נתוני פעילות...</p>}
  </Card>;
}

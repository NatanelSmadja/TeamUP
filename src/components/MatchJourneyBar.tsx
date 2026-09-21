import {useQuery} from '@tanstack/react-query';
import {ArrowLeft, Check, CircleDot, Clock3} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import type {Match} from '../types';

const stages = ['הרשמה', 'חלוקה', 'משחק', 'סיכום'];

export default function MatchJourneyBar() {
  const {user} = useAuth();
  const {data: group} = useGroup();
  const {data} = useQuery({
    queryKey: ['ux-active-match', group?.group.id, user?.id],
    enabled: Boolean(group && user),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const {data: match, error} = await supabase
        .from('matches')
        .select('*')
        .eq('group_id', group!.group.id)
        .in('status', ['registration_open', 'registration_closed', 'teams_published'])
        .gte('match_date', today)
        .order('match_date')
        .order('start_time')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!match) return null;
      const {data: registration} = await supabase
        .from('match_registrations')
        .select('registration_status')
        .eq('match_id', match.id)
        .eq('user_id', user!.id)
        .maybeSingle();
      return {match: match as Match, registration};
    },
  });

  if (!data?.match) return null;
  const {match, registration} = data;
  const start = new Date(`${match.match_date}T${match.start_time}`);
  const end = match.end_time ? new Date(`${match.match_date}T${match.end_time}`) : new Date(start.getTime() + 90 * 60 * 1000);
  const live = match.status === 'teams_published' && Date.now() >= start.getTime() && Date.now() <= end.getTime();
  const stage = match.status === 'registration_open' ? 0 : match.status === 'registration_closed' ? 1 : live ? 2 : 1;
  const registered = Boolean(registration);
  const status = live ? 'המשחק התחיל' : match.status === 'teams_published' ? 'הקבוצות פורסמו' : match.status === 'registration_closed' ? 'ההרשמה נסגרה' : registered ? 'המקום שלך שמור' : 'ההרשמה פתוחה';
  const action = live ? 'ללוח המשחק' : match.status === 'teams_published' ? 'לצפייה בקבוצות' : match.status === 'registration_open' && !registered ? 'להרשמה' : 'לפרטי המשחק';
  const date = new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'short', day: 'numeric', month: 'short'});

  return <section className="journey-bar" aria-label="מצב המשחק הקרוב">
    <div className="journey-current"><CircleDot size={16}/><span><small>{date} בשעה {match.start_time.slice(0, 5)}</small><strong>{status}</strong></span></div>
    <div className="journey-steps" aria-label={`שלב נוכחי ${stages[stage]}`}>
      {stages.map((label, index) => <span key={label} className={index < stage ? 'done' : index === stage ? 'current' : ''}><i>{index < stage ? <Check size={11}/> : index + 1}</i><b>{label}</b></span>)}
    </div>
    <Link to={`/matches/${match.id}`} className="journey-action">{live && <Clock3 size={15}/>}<span>{action}</span><ArrowLeft size={15}/></Link>
  </section>;
}

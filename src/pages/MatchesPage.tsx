import {useMemo} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link, useSearchParams} from 'react-router-dom';
import {ChevronLeft, MapPin} from 'lucide-react';
import {Badge, Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {useAuth} from '../contexts/AuthContext';
import {supabase} from '../lib/supabase';
import {statusLabel} from '../lib/utils';
import type {Match} from '../types';

type MatchView = 'upcoming' | 'past';

export default function MatchesPage() {
  const {data: group} = useGroup();
  const {user} = useAuth();
  const [params, setParams] = useSearchParams();
  const view: MatchView = params.get('view') === 'past' ? 'past' : 'upcoming';
  const query = useQuery({
    queryKey: ['matches', group?.group.id, user?.id],
    enabled: !!group && !!user,
    queryFn: async () => {
      const {data: matches, error} = await supabase.from('matches').select('*').eq('group_id', group!.group.id).order('match_date', {ascending: false}).limit(80);
      if (error) throw error;
      const ids = (matches || []).map((match) => match.id);
      const {data: registrations, error: registrationError} = ids.length
        ? await supabase.from('match_registrations').select('match_id,registration_status').eq('user_id', user!.id).in('match_id', ids)
        : {data: [], error: null};
      if (registrationError) throw registrationError;
      const mine = new Map((registrations || []).map((row: any) => [row.match_id, row.registration_status]));
      return (matches || []).map((match) => ({...match, myStatus: mine.get(match.id) || null})) as Array<Match & {myStatus: string | null}>;
    },
  });
  const groups = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = query.data || [];
    return {
      upcoming: rows.filter((match) => !['completed', 'cancelled'].includes(match.status) && match.match_date >= today).sort((a, b) => a.match_date.localeCompare(b.match_date)),
      past: rows.filter((match) => ['completed', 'cancelled'].includes(match.status) || match.match_date < today),
    };
  }, [query.data]);
  const rows = groups[view];
  const choose = (next: MatchView) => setParams(next === 'past' ? {view: 'past'} : {}, {replace: true});

  return <div className="matches-page unified-matches-page">
    <div className="page-heading matches-heading"><div><p>המשחקים הקרובים וכל מה שכבר היה</p><h1>משחקים</h1></div></div>
    <div className="segmented matches-view-tabs" role="tablist" aria-label="סינון משחקים">
      <button className={view === 'upcoming' ? 'active' : ''} onClick={() => choose('upcoming')}>קרובים <span>{groups.upcoming.length}</span></button>
      <button className={view === 'past' ? 'active' : ''} onClick={() => choose('past')}>קודמים <span>{groups.past.length}</span></button>
    </div>
    {query.isLoading && <div className="list-skeleton" aria-label="טוען משחקים"><i/><i/><i/></div>}
    {query.isError && <Card className="empty-state"><h2>לא הצלחנו לטעון את המשחקים</h2><button onClick={() => query.refetch()}>ניסיון נוסף</button></Card>}
    {!query.isLoading && !query.isError && <div className="matches-list">{rows.map((match) => {
      const date = new Date(`${match.match_date}T12:00:00`);
      const myLabel = match.myStatus === 'confirmed' ? 'אני בפנים' : match.myStatus === 'waitlisted' ? 'בהמתנה' : null;
      return <Link key={match.id} to={`/matches/${match.id}`} className="match-list-link"><Card className="match-list-card">
        <div className="match-list-date"><strong>{date.toLocaleDateString('he-IL', {day: 'numeric'})}</strong><small>{date.toLocaleDateString('he-IL', {month: 'short'})}</small></div>
        <div className="match-list-copy"><div><h2>{match.title}</h2><Badge>{statusLabel(match.status)}</Badge></div><p>{date.toLocaleDateString('he-IL', {weekday: 'long'})} · {match.start_time.slice(0, 5)}</p><span><MapPin size={14}/>{match.location || 'המיקום יעודכן'}</span>{myLabel && <em className={`my-match-status ${match.myStatus}`}>{myLabel}</em>}</div>
        <ChevronLeft className="match-list-arrow"/>
      </Card></Link>;
    })}{!rows.length && <Card className="empty-state"><h2>{view === 'upcoming' ? 'אין כרגע משחק קרוב' : 'עוד אין משחקים קודמים'}</h2><p>{view === 'upcoming' ? 'משחק חדש יופיע כאן ברגע שהמנהל יפתח אותו.' : 'משחקים שהסתיימו יישמרו כאן.'}</p></Card>}</div>}
  </div>;
}

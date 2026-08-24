import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {Activity, ArrowLeft, CalendarDays, CheckCircle2, Clock, Crown, Goal, MapPin, ShieldCheck, Star, Trophy, Users} from 'lucide-react';
import {Badge, Button, Card} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {canManage, useGroup} from '../hooks/useGroup';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import {fullName, isPollPast, statusLabel} from '../lib/utils';
import type {Match, Registration} from '../types';
import GroupDashboardCard from '../components/GroupDashboardCard';

const matchDate = (value: string, options: Intl.DateTimeFormatOptions) => new Date(`${value}T12:00:00`).toLocaleDateString('he-IL', options);

export default function HomePage() {
  const {profile, user} = useAuth();
  const {data: g} = useGroup();
  const manager = canManage(g);
  const key = ['v3-home', g?.group.id, user?.id] as const;
  const {data, isLoading} = useQuery({
    queryKey: key,
    enabled: !!g && !!user,
    queryFn: async () => {
      const [{data: matches}, {data: polls}, {data: activity}, {data: stats}, {data: members}, {data: ratingMatches}, {data: goalStats}, {data: goalLeaders}] = await Promise.all([
        supabase.from('matches').select('*').eq('group_id', g!.group.id).in('status', ['registration_open', 'registration_closed', 'teams_published']).gte('match_date', new Date().toISOString().slice(0, 10)).order('match_date').order('start_time').limit(8),
        supabase.from('weekly_polls').select('*,availability_votes(day_of_week,user_id),weekly_poll_responses(user_id,response)').eq('group_id', g!.group.id).eq('status', 'open').order('week_start', {ascending: false}).order('created_at', {ascending: false}).limit(5),
        supabase.from('activity_events').select('*').eq('group_id', g!.group.id).order('created_at', {ascending: false}).limit(4),
        supabase.from('player_public_stats').select('*').eq('group_id', g!.group.id),
        supabase.from('group_members').select('user_id,profiles(*)').eq('group_id', g!.group.id).eq('status', 'active'),
        supabase.from('matches').select('id,title,match_date,start_time,ratings_closes_at').eq('group_id', g!.group.id).eq('ratings_open', true).or(`ratings_closes_at.is.null,ratings_closes_at.gt.${new Date().toISOString()}`).order('match_date', {ascending: false}).limit(5),
        supabase.rpc('get_player_goal_stats', {p_user_id: user!.id, p_group_id: g!.group.id, p_match_id: null}),
        supabase.rpc('get_group_goal_leaderboard', {p_group_id: g!.group.id, p_month: null}),
      ]);
      const matchRows = (matches || []) as Match[];
      const regsByMatch: Record<string, Registration[]> = {};
      const guestCountByMatch: Record<string, number> = {};
      if (matchRows.length) {
        const matchIds = matchRows.map((match) => match.id);
        const [{data: regs, error}, {data: guests, error: guestsError}] = await Promise.all([
          supabase.from('match_registrations').select('*,profiles!match_registrations_user_id_fkey(*)').in('match_id', matchIds).order('registered_at'),
          supabase.from('match_guests').select('match_id').in('match_id', matchIds),
        ]);
        if (error) throw error;
        if (guestsError) throw guestsError;
        for (const registration of (regs || []) as Registration[]) (regsByMatch[registration.match_id] ??= []).push(registration);
        for (const guest of guests || []) guestCountByMatch[guest.match_id] = (guestCountByMatch[guest.match_id] || 0) + 1;
      }
      let openRatings: any[] = [];
      if (ratingMatches?.length) {
        const {data: attended, error} = await supabase.from('match_registrations').select('match_id').eq('user_id', user!.id).eq('registration_status', 'confirmed').eq('attended', true).in('match_id', ratingMatches.map((match: any) => match.id));
        if (error) throw error;
        const allowedMatches = new Set((attended || []).map((row: any) => row.match_id));
        openRatings = ratingMatches.filter((match: any) => allowedMatches.has(match.id));
      }
      const statMap = new Map((stats || []).map((row: any) => [row.user_id, row]));
      const players = (members || []).map((member: any) => {
        const stat: any = statMap.get(member.user_id);
        return {...member, mvp: Number(stat?.mvp_count || 0), games: Number(stat?.games_count || 0), rating: Number(stat?.avg_rating ?? member.profiles.base_rating ?? 3)};
      }).sort((a: any, b: any) => b.mvp - a.mvp || b.rating - a.rating);
      const meIndex = players.findIndex((player: any) => player.user_id === user!.id);
      return {
        matches: matchRows,
        regsByMatch,
        guestCountByMatch,
        polls: (polls || []).filter((poll: any) => !isPollPast(poll.week_start)),
        openRatings,
        activity: activity || [],
        leader: players[0],
        me: meIndex >= 0 ? players[meIndex] : null,
        meRank: meIndex >= 0 ? meIndex + 1 : null,
        goals: Number(goalStats?.[0]?.total_goals || 0),
        goalLeaders: (goalLeaders || []).slice(0, 5).map((player: any) => ({...player, goals: Number(player.goals || 0)})),
      };
    },
  });
  useRealtimeInvalidation(`v3home-${g?.group.id}`, ['matches', 'match_registrations', 'match_guests', 'weekly_polls', 'availability_votes', 'weekly_poll_responses', 'activity_events', 'player_public_stats', 'goal_events'], [key], !!g);

  const featured = data?.matches[0];
  const featuredRegs = featured ? data?.regsByMatch[featured.id] || [] : [];
  const confirmed = featuredRegs.filter((registration) => registration.registration_status === 'confirmed').length + (featured ? data?.guestCountByMatch[featured.id] || 0 : 0);
  const myReg = featuredRegs.find((registration) => registration.user_id === user?.id);
  const activePoll = data?.polls[0];
  const votes: any[] = activePoll?.availability_votes || [];
  const pollResponses: any[] = activePoll?.weekly_poll_responses || [];
  const answeredPoll = votes.some((vote) => vote.user_id === user?.id) || pollResponses.some((response) => response.user_id === user?.id);
  const pendingPoll = activePoll && !answeredPoll ? activePoll : null;
  const ratingMatch = data?.openRatings?.[0];
  const taskCount = Number(Boolean(ratingMatch)) + Number(Boolean(pendingPoll));
  const waiting = featuredRegs.filter((registration) => registration.registration_status === 'waitlisted').length;
  const spotsLeft = featured ? Math.max(0, featured.capacity - confirmed) : 0;
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'בוקר טוב' : now.getHours() < 18 ? 'צהריים טובים' : 'ערב טוב';
  const todayLabel = now.toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'});
  const featuredAction = myReg?.registration_status === 'confirmed' || myReg?.registration_status === 'waitlisted'
    ? featured?.status === 'teams_published' ? 'צפייה בקבוצות' : 'לפרטי המשחק'
    : featured?.status === 'registration_open' ? 'הרשמה עכשיו' : 'לפרטי המשחק';
  const topScorer = data?.goalLeaders?.[0];
  const maxGoals = Math.max(...(data?.goalLeaders || []).map((player: any) => player.goals), 1);

  return <div className="home-command">
    <header className="home-welcome">
      <div><p>{g?.group.name || 'TEAMUP CLUB'}</p><h1>{greeting}, {profile?.first_name || 'שחקן'}</h1><span>המשחק הבא, המשימות והמספרים שלך — במקום אחד.</span></div>
      <div className="home-today"><CalendarDays size={18}/><span>{todayLabel}</span></div>
    </header>

    {isLoading ? <HomeSkeleton/> : <>
      {taskCount > 0 && <Card className="home-inbox">
        <div className="home-inbox-title"><span><CheckCircle2 size={19}/></span><div><small>דורש תשומת לב</small><strong>{taskCount === 1 ? 'פעולה אחת מחכה לך' : `${taskCount} פעולות מחכות לך`}</strong></div></div>
        <div className="home-inbox-actions">
          {ratingMatch && <Link to="/ratings"><Star size={18}/><span><strong>דירוג ו־MVP</strong><small>{ratingMatch.title}</small></span><ArrowLeft size={17}/></Link>}
          {pendingPoll && <Link to={`/availability?poll=${pendingPoll.id}`}><CalendarDays size={18}/><span><strong>סקר זמינות</strong><small>{pendingPoll.title || 'בחר את הימים שלך'}</small></span><ArrowLeft size={17}/></Link>}
        </div>
      </Card>}

      <section className="home-focus-grid">
        {featured ? <Card className="home-next-match" style={{'--club-color': g?.group.theme_color || '#4f8cff'} as React.CSSProperties}>
          <div className="home-next-top"><div><span className="home-live-dot"/><small>המשחק הבא</small><Badge>{statusLabel(featured.status)}</Badge></div><span className={`home-my-status ${myReg?.registration_status === 'confirmed' ? 'confirmed' : myReg?.registration_status === 'waitlisted' ? 'waiting' : ''}`}>{myReg?.registration_status === 'confirmed' ? '✓ אתה בפנים' : myReg?.registration_status === 'waitlisted' ? 'בהמתנה' : 'לא נרשמת'}</span></div>
          <div className="home-next-content">
            <div className="home-next-date"><strong>{matchDate(featured.match_date, {day: '2-digit'})}</strong><span>{matchDate(featured.match_date, {month: 'short'})}</span></div>
            <div className="home-next-copy"><h2>{featured.title}</h2><div><span><CalendarDays/>{matchDate(featured.match_date, {weekday: 'long'})}</span><span><Clock/>{featured.start_time.slice(0, 5)}</span><span><MapPin/>{featured.location || 'המיקום יעודכן'}</span></div></div>
          </div>
          <div className="home-registration"><div><span><Users size={17}/><strong>{confirmed}</strong> מתוך {featured.capacity}</span><small>{spotsLeft ? `${spotsLeft} מקומות נותרו` : waiting ? `${waiting} שחקנים ממתינים` : 'ההרשמה מלאה'}</small></div><div><i style={{width: `${Math.min(100, (confirmed / Math.max(featured.capacity, 1)) * 100)}%`}}/></div></div>
          <div className="home-next-footer"><Link to={`/matches/${featured.id}`}><Button>{featuredAction}<ArrowLeft size={17}/></Button></Link><Link to="/matches">כל המשחקים</Link></div>
        </Card> : <Card className="home-no-match"><CalendarDays size={34}/><div><small>השבוע שלך פנוי</small><h2>אין כרגע משחק קרוב</h2><p>משחק חדש או סקר זמינות יופיעו כאן ברגע שייפתחו.</p></div><Link to="/availability"><Button variant="secondary">לסקרי הזמינות</Button></Link></Card>}

        <Card className="home-player-pulse">
          <div className="home-pulse-head"><div><small>העונה שלך</small><h2>המספרים שלי</h2></div><Link to={user ? `/players/${user.id}` : '/profile'}>לכרטיס השחקן <ArrowLeft size={15}/></Link></div>
          <div className="home-personal-stats">
            <Link to="/history"><CalendarDays/><strong>{data?.me?.games || 0}</strong><span>משחקים</span></Link>
            <Link to="/stats"><Goal/><strong>{data?.goals || 0}</strong><span>שערים</span></Link>
            <Link to="/stats"><Star/><strong>{data?.me?.rating?.toFixed(1) || '3.0'}</strong><span>דירוג</span></Link>
            <Link to="/stats"><Trophy/><strong>{data?.me?.mvp || 0}</strong><span>MVP</span></Link>
          </div>
          <div className="home-leader-note"><Trophy size={18}/><div><span>המיקום שלך בקבוצה</span><strong>{data?.meRank ? `מקום ${data.meRank} בדירוג הקבוצתי` : 'הדירוג יופיע אחרי המשחקים הראשונים'}</strong></div></div>
        </Card>
      </section>

      <section className="home-team-insights">
        <div className="home-insights-heading"><div><small>TEAM PULSE</small><h2>תמונת הקבוצה</h2><p>המובילים והכובשים, לפי המשחקים שהושלמו והשערים שאושרו.</p></div><Link to="/stats">לכל הסטטיסטיקות <ArrowLeft size={16}/></Link></div>
        <div className="home-insights-grid">
          <Card className="home-scorers-chart">
            <div className="home-chart-title"><div><Goal size={20}/><span><small>כל הזמנים</small><strong>כובשים מובילים</strong></span></div><Badge>TOP 5</Badge></div>
            <div className="home-chart-bars">
              {data?.goalLeaders.map((player: any, index: number) => <Link to={`/players/${player.user_id}`} key={player.user_id} className={index === 0 ? 'leader' : ''}>
                <b>{index + 1}</b><span className="player-avatar sm">{player.first_name?.[0] || 'ש'}</span><span className="home-chart-player"><strong>{player.first_name} {player.last_name}</strong><i><em style={{width: `${Math.max(8, player.goals / maxGoals * 100)}%`}}/></i></span><span className="home-chart-value"><strong>{player.goals}</strong><small>שערים</small></span>
              </Link>)}
              {!data?.goalLeaders.length && <div className="home-chart-empty"><Goal size={25}/><span><strong>עוד אין כובשים בטבלה</strong><small>שערים מאושרים יתחילו לבנות את הגרף.</small></span></div>}
            </div>
          </Card>
          <div className="home-standouts">
            <Card className="home-standout goal-king"><div className="home-standout-icon"><Crown/></div><div><small>מלך השערים</small><h3>{topScorer ? `${topScorer.first_name} ${topScorer.last_name}` : 'הכתר עדיין פנוי'}</h3><p>{topScorer ? `${topScorer.goals} שערים מאושרים` : 'הכובש הראשון יופיע כאן'}</p></div>{topScorer && <Link to={`/players/${topScorer.user_id}`}><ArrowLeft/></Link>}</Card>
            <Card className="home-standout team-leader"><div className="home-standout-icon"><Trophy/></div><div><small>מוביל הקבוצה</small><h3>{data?.leader ? fullName(data.leader.profiles) : 'עוד אין מוביל'}</h3><p>{data?.leader ? `${data.leader.mvp} זכיות MVP · דירוג ${data.leader.rating.toFixed(1)}` : 'הנתונים יופיעו לאחר משחקים ודירוגים'}</p></div>{data?.leader && <Link to={`/players/${data.leader.user_id}`}><ArrowLeft/></Link>}</Card>
          </div>
        </div>
      </section>

      <section className="home-secondary-grid">
        <Card className="home-compact-card">
          <div className="section-title"><h2><CalendarDays size={18}/>בהמשך השבוע</h2><Link to="/matches">הכול</Link></div>
          <div className="home-upcoming-list">
            {data?.matches.slice(1, 4).map((match) => {
              const registrations = data.regsByMatch[match.id] || [];
              const count = registrations.filter((registration) => registration.registration_status === 'confirmed').length + (data.guestCountByMatch[match.id] || 0);
              return <Link key={match.id} to={`/matches/${match.id}`}><span className="home-mini-date"><strong>{matchDate(match.match_date, {day: '2-digit'})}</strong><small>{matchDate(match.match_date, {month: 'short'})}</small></span><span><strong>{match.title}</strong><small>{matchDate(match.match_date, {weekday: 'long'})} · {match.start_time.slice(0, 5)}</small></span><Badge>{count}/{match.capacity}</Badge></Link>;
            })}
            {!data?.matches.slice(1).length && <p className="empty-inline">אין משחק נוסף בלוח כרגע.</p>}
          </div>
        </Card>

        <Card className="home-compact-card">
          <div className="section-title"><h2><CalendarDays size={18}/>זמינות השבוע</h2><Link to="/availability">לסקרים</Link></div>
          {activePoll ? <Link className="home-poll-summary" to={`/availability?poll=${activePoll.id}`}><span className={answeredPoll ? 'answered' : ''}>{answeredPoll ? <CheckCircle2/> : <CalendarDays/>}</span><div><small>{answeredPoll ? 'התשובה שלך נשמרה' : 'עדיין לא ענית'}</small><strong>{activePoll.title || 'סקר זמינות'}</strong><p>{answeredPoll ? 'אפשר לעדכן כל עוד הסקר פתוח' : 'בחר עכשיו את הימים שמתאימים לך'}</p></div><ArrowLeft size={18}/></Link> : <p className="empty-inline">אין סקר פתוח השבוע.</p>}
        </Card>

        <Card className="home-compact-card">
          <div className="section-title"><h2><Activity size={18}/>מה חדש בקבוצה</h2><Link to="/activity">הכול</Link></div>
          <div className="home-activity-list">{data?.activity.slice(0, 3).map((event: any) => <Link key={event.id} to={event.entity_type === 'match' ? `/matches/${event.entity_id}` : event.entity_type === 'poll' ? `/availability?poll=${event.entity_id}` : event.entity_type === 'rating' ? '/ratings' : '/activity'}><i/><span><strong>{event.title}</strong><small>{new Date(event.created_at).toLocaleDateString('he-IL', {day: 'numeric', month: 'short'})} · {new Date(event.created_at).toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'})}</small></span></Link>)}{!data?.activity.length && <p className="empty-inline">עדיין אין פעילות חדשה.</p>}</div>
        </Card>
      </section>

      {manager && g && <Card className="home-manager-overview"><div><ShieldCheck size={19}/><span><small>תצוגת מנהל</small><strong>מצב הקבוצה</strong></span></div><GroupDashboardCard groupId={g.group.id}/><Link to="/admin">למרכז הניהול <ArrowLeft size={16}/></Link></Card>}
    </>}
  </div>;
}

function HomeSkeleton() {
  return <div className="home-skeleton" aria-label="טוען את מסך הבית"><i/><div><i/><i/></div><div><i/><i/><i/></div></div>;
}

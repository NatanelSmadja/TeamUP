import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {Activity, ArrowLeft, BarChart3, CalendarDays, CheckCircle2, Clock, MapPin, Star, Trophy, Users} from 'lucide-react';
import {Badge, Button, Card} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import {fullName, isPollPast, statusLabel} from '../lib/utils';
import type {Match, Registration} from '../types';
import GroupDashboardCard from '../components/GroupDashboardCard';

export default function HomePage() {
  const {profile, user} = useAuth();
  const {data: g} = useGroup();
  const key = ['v25-home', g?.group.id, user?.id] as const;
  const {data, isLoading} = useQuery({
    queryKey: key,
    enabled: !!g,
    queryFn: async () => {
      const [{data: matches}, {data: polls}, {data: activity}, {data: stats}, {data: members}, {data: ratingMatches}] = await Promise.all([
        supabase
          .from('matches')
          .select('*')
          .eq('group_id', g!.group.id)
          .in('status', ['registration_open', 'registration_closed', 'teams_published'])
          .gte('match_date', new Date().toISOString().slice(0, 10))
          .order('match_date')
          .order('start_time')
          .limit(8),
        supabase
          .from('weekly_polls')
          .select('*,availability_votes(day_of_week,user_id),weekly_poll_responses(user_id,response)')
          .eq('group_id', g!.group.id)
          .eq('status', 'open')
          .order('week_start', {ascending: false})
          .order('created_at', {ascending: false})
          .limit(5),
        supabase.from('activity_events').select('*').eq('group_id', g!.group.id).order('created_at', {ascending: false}).limit(5),
        supabase.from('player_public_stats').select('*').eq('group_id', g!.group.id),
        supabase.from('group_members').select('user_id,profiles(*)').eq('group_id', g!.group.id).eq('status', 'active'),
        supabase
          .from('matches')
          .select('id,title,match_date,start_time,ratings_closes_at')
          .eq('group_id', g!.group.id)
          .eq('ratings_open', true)
          .or(`ratings_closes_at.is.null,ratings_closes_at.gt.${new Date().toISOString()}`)
          .order('match_date', {ascending: false})
          .limit(5),
      ]);
      const matchRows = (matches || []) as Match[];
      const regsByMatch: Record<string, Registration[]> = {};
      const guestCountByMatch: Record<string, number> = {};
      if (matchRows.length) {
        const matchIds = matchRows.map((m) => m.id);
        const [{data: regs, error}, {data: guests, error: guestsError}] = await Promise.all([
          supabase.from('match_registrations').select('*,profiles!match_registrations_user_id_fkey(*)').in('match_id', matchIds).order('registered_at'),
          supabase.from('match_guests').select('match_id').in('match_id', matchIds),
        ]);
        if (error) throw error;
        if (guestsError) throw guestsError;
        for (const r of (regs || []) as Registration[]) (regsByMatch[r.match_id] ??= []).push(r);
        for (const guest of guests || []) guestCountByMatch[guest.match_id] = (guestCountByMatch[guest.match_id] || 0) + 1;
      }
      let openRatings: any[] = [];
      if (user && ratingMatches?.length) {
        const {data: attended, error} = await supabase
          .from('match_registrations')
          .select('match_id')
          .eq('user_id', user.id)
          .eq('registration_status', 'confirmed')
          .eq('attended', true)
          .in(
            'match_id',
            ratingMatches.map((match: any) => match.id),
          );
        if (error) throw error;
        const allowedMatches = new Set((attended || []).map((row: any) => row.match_id));
        openRatings = ratingMatches.filter((match: any) => allowedMatches.has(match.id));
      }
      const statMap = new Map((stats || []).map((x: any) => [x.user_id, x]));
      const rows = (members || [])
        .map((m: any) => {
          const st: any = statMap.get(m.user_id);
          return {...m, mvp: Number(st?.mvp_count || 0), rating: Number(st?.avg_rating ?? m.profiles.base_rating ?? 3)};
        })
        .sort((a: any, b: any) => b.mvp - a.mvp || b.rating - a.rating);
      return {
        matches: matchRows,
        regsByMatch,
        guestCountByMatch,
        polls: (polls || []).filter((p: any) => !isPollPast(p.week_start)),
        openRatings,
        activity: activity || [],
        leader: rows[0],
        myRating: rows.find((x: any) => x.user_id === user?.id),
      };
    },
  });
  useRealtimeInvalidation(
    `v25home-${g?.group.id}`,
    ['matches', 'match_registrations', 'match_guests', 'weekly_polls', 'availability_votes', 'weekly_poll_responses', 'activity_events', 'player_public_stats'],
    [key],
    !!g,
  );
  const featured = data?.matches[0];
  const featuredRegs = featured ? data?.regsByMatch[featured.id] || [] : [];
  const confirmed = featuredRegs.filter((x) => x.registration_status === 'confirmed').length + (featured ? data?.guestCountByMatch[featured.id] || 0 : 0);
  const myReg = featuredRegs.find((x) => x.user_id === user?.id);
  const activePoll = data?.polls[0];
  const votes: any[] = activePoll?.availability_votes || [];
  const pollResponses: any[] = activePoll?.weekly_poll_responses || [];
  const answeredActivePoll = votes.some((vote) => vote.user_id === user?.id) || pollResponses.some((response) => response.user_id === user?.id);
  const ratingMatch = data?.openRatings?.[0];
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'בוקר טוב' : now.getHours() < 18 ? 'צהריים טובים' : 'ערב טוב';
  const todayLabel = now.toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'});
  const waiting = featuredRegs.filter((x) => x.registration_status === 'waitlisted').length;
  const spotsLeft = featured ? Math.max(0, featured.capacity - confirmed) : 0;
  const dayCounts = [0, 1, 2, 3, 4, 5, 6]
    .map((day) => ({day, count: votes.filter((v) => v.day_of_week === day).length}))
    .sort((a, b) => b.count - a.count);
  return (
    <div className="dashboard-v2">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="home-eyebrow">{g?.group.name || 'TEAMUP CLUB'}</p>
          <h1>{greeting}, {profile?.first_name || 'שחקן'}</h1>
          <span>הנה מה שקורה בקבוצה שלך עכשיו.</span>
        </div>
        <div className="home-date-chip"><CalendarDays size={18}/><span>{todayLabel}</span></div>
      </header>
      {g && <GroupDashboardCard groupId={g.group.id} />}
      {!isLoading && (ratingMatch || activePoll) && (
        <Card className="home-action-center home-section-card">
          <div className="section-title">
            <div className="home-section-heading"><span className="home-section-icon"><CheckCircle2 size={19} /></span><div><small>TO DO</small><h2>מחכה לפעולה שלך</h2></div></div>
            <Badge>{Number(Boolean(ratingMatch)) + Number(Boolean(activePoll))} משימות</Badge>
          </div>
          <div className="home-action-grid">
            {ratingMatch && (
              <Link className="home-action-card rating-action" to="/ratings">
                <span className="home-action-icon">
                  <Star size={22} />
                </span>
                <span className="home-action-copy">
                  <small>הדירוג נפתח</small>
                  <strong>{ratingMatch.title}</strong>
                  <span>דרג את מי ששיחק איתך ובחר MVP</span>
                </span>
                <ArrowLeft size={19} />
              </Link>
            )}
            {activePoll && (
              <Link className="home-action-card poll-action" to={`/availability?poll=${activePoll.id}`}>
                <span className="home-action-icon">
                  <CalendarDays size={22} />
                </span>
                <span className="home-action-copy">
                  <small>{answeredActivePoll ? 'התשובה שלך נשמרה' : 'סקר חדש מחכה לך'}</small>
                  <strong>{activePoll.title || 'סקר זמינות'}</strong>
                  <span>{answeredActivePoll ? 'אפשר לעדכן את הבחירה כל עוד הסקר פתוח' : 'בחר באילו ימים אתה יכול להגיע'}</span>
                </span>
                <ArrowLeft size={19} />
              </Link>
            )}
          </div>
        </Card>
      )}
      <div className="dashboard-grid">
        <section className="dashboard-main">
          {isLoading ? (
            <Card>טוען את הדשבורד...</Card>
          ) : featured ? (
            <>
              <Card className="featured-match">
                <div className="featured-head">
                  <div><small>המשחק הבא</small><Badge><span className="status-dot" />{statusLabel(featured.status)}</Badge></div>
                  <span className={`my-match-state ${myReg?.registration_status === 'confirmed' ? 'is-confirmed' : myReg?.registration_status === 'waitlisted' ? 'is-waiting' : ''}`}>
                    {myReg?.registration_status === 'confirmed'
                      ? '✓ אתה בפנים'
                      : myReg?.registration_status === 'waitlisted'
                        ? 'ברשימת המתנה'
                        : 'עדיין לא נרשמת'}
                  </span>
                </div>
                <div className="featured-body">
                  <div className="featured-date-block"><strong>{new Date(`${featured.match_date}T12:00:00`).toLocaleDateString('he-IL', {day: '2-digit'})}</strong><span>{new Date(`${featured.match_date}T12:00:00`).toLocaleDateString('he-IL', {month: 'short'})}</span></div>
                  <div className="featured-copy">
                    <h2>{featured.title}</h2>
                    <div className="featured-meta">
                      <span><CalendarDays />{new Date(`${featured.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long'})}</span>
                      <span><Clock />{featured.start_time.slice(0, 5)}</span>
                      <span><MapPin />{featured.location || 'מיקום יעודכן'}</span>
                    </div>
                  </div>
                </div>
                <div className="registration-meter">
                  <div>
                    <span><Users size={18} /><strong>{confirmed}</strong> מתוך {featured.capacity} נרשמו</span>
                    <small>{spotsLeft ? `נותרו ${spotsLeft} מקומות` : waiting ? `${waiting} בהמתנה` : 'הרשימה מלאה'}</small>
                  </div>
                  <div className="meter">
                    <i style={{width: `${Math.min(100, (confirmed / featured.capacity) * 100)}%`}} />
                  </div>
                </div>
                <div className="featured-footer"><Link to={`/matches/${featured.id}`}><Button>{myReg?.registration_status === 'confirmed' || myReg?.registration_status === 'waitlisted' ? 'לפרטי המשחק' : featured.status === 'registration_open' ? 'להרשמה למשחק' : 'לפרטי המשחק'} <ArrowLeft size={17} /></Button></Link><Link to="/matches">כל המשחקים</Link></div>
              </Card>
              {data!.matches.length > 1 && (
                <Card className="home-list-card">
                  <div className="section-title">
                    <h2>
                      <CalendarDays size={19} />
                      משחקים נוספים
                    </h2>
                    <Link to="/matches">כל המשחקים</Link>
                  </div>
                  <div className="upcoming-match-list">
                    {data!.matches.slice(1).map((m) => {
                      const regs = data!.regsByMatch[m.id] || [];
                      const count = regs.filter((r) => r.registration_status === 'confirmed').length + (data!.guestCountByMatch[m.id] || 0);
                      return (
                        <Link key={m.id} to={`/matches/${m.id}`}>
                          <div>
                            <strong>{m.title}</strong>
                            <span>
                              {new Date(`${m.match_date}T12:00:00`).toLocaleDateString('he-IL', {
                                weekday: 'long',
                                day: 'numeric',
                                month: 'numeric',
                              })}{' '}
                              · {m.start_time.slice(0, 5)}
                            </span>
                          </div>
                          <Badge>
                            {count}/{m.capacity}
                          </Badge>
                        </Link>
                      );
                    })}
                  </div>
                </Card>
              )}
            </>
          ) : (
            <Card className="empty-state">
              <CalendarDays size={36} />
              <h2>אין כרגע משחק פתוח</h2>
              <p>בדוק את סקרי הזמינות או פתח משחק חדש.</p>
              <Link to="/availability">
                <Button variant="secondary">לסקרים</Button>
              </Link>
            </Card>
          )}
          <Card className="quick-stats" aria-label="הנתונים שלי">
            <Link to="/stats">
              <BarChart3 />
              <div>
                <strong>{data?.myRating?.rating?.toFixed(2) || '3.00'}</strong>
                <span>הדירוג שלך</span>
              </div>
            </Link>
            <Link to="/stats">
              <Trophy />
              <div>
                <strong>{data?.myRating?.mvp || 0}</strong>
                <span>זכיות MVP</span>
              </div>
            </Link>
            <Link to="/squad">
              <Users />
              <div>
                <strong>{data?.leader ? fullName(data.leader.profiles) : '—'}</strong>
                <span>מוביל הקבוצה</span>
              </div>
            </Link>
          </Card>
        </section>
        <aside className="dashboard-side">
          <Card className="home-side-card">
            <div className="section-title">
              <h2>
                <CalendarDays size={19} />
                סקרים פתוחים
              </h2>
              <Link to="/availability">לכל הסקרים</Link>
            </div>
            {activePoll ? (
              <>
                <Link className="active-poll-link" to={`/availability?poll=${activePoll.id}`}>
                  <strong>{activePoll.title || 'סקר זמינות'}</strong>
                  <span>{data?.polls.length || 1} סקרים פתוחים כרגע</span>
                </Link>
                <div className="poll-mini">
                  {dayCounts.slice(0, 4).map((d: any) => (
                    <div key={d.day}>
                      <span>{['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][d.day]}</span>
                      <i>
                        <b
                          style={{
                            width: `${votes.length ? Math.max(7, (d.count / Math.max(...dayCounts.map((x) => x.count), 1)) * 100) : 0}%`,
                          }}
                        />
                      </i>
                      <strong>{d.count}</strong>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="empty-inline">אין סקר פתוח.</p>
            )}
          </Card>
          <Card className="home-side-card">
            <div className="section-title">
              <h2>
                <Activity size={19} />
                פעילות בלייב
              </h2>
              <Link to="/activity">הכול</Link>
            </div>
            <div className="activity-mini">
              {data?.activity.map((e: any) => (
                <Link
                  key={e.id}
                  to={
                    e.entity_type === 'match'
                      ? `/matches/${e.entity_id}`
                      : e.entity_type === 'poll'
                        ? `/availability?poll=${e.entity_id}`
                        : e.entity_type === 'rating'
                          ? '/ratings'
                          : '/activity'
                  }
                >
                  <span />
                  <div>
                    <strong>{e.title}</strong>
                    <small>{new Date(e.created_at).toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'})}</small>
                  </div>
                </Link>
              ))}
              {!data?.activity.length && <p className="empty-inline">עדיין אין פעילות.</p>}
            </div>
          </Card>
          <Card className="mvp-spotlight">
            <Star />
            <div>
              <small>HALL OF FAME</small>
              <h2>{data?.leader ? fullName(data.leader.profiles) : 'עדיין אין מוביל'}</h2>
              <p>{data?.leader ? `${data.leader.mvp} זכיות MVP · דירוג ${data.leader.rating.toFixed(2)}` : 'הדירוגים הראשונים יופיעו כאן'}</p>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

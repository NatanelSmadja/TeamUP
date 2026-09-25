import PlayerAvatar from '../components/PlayerAvatar';
import GoalScorersDialog from '../components/GoalScorersDialog';
import RatingLeadersDialog from '../components/RatingLeadersDialog';
import {useAuth} from '../contexts/AuthContext';
import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router-dom';
import {Badge, Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {fullName} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {useState} from 'react';

const achievementDefs = [
  {key: 'first_match', title: 'משחק ראשון', desc: 'הופעה ראשונה ב־TEAMUP', test: (p: any) => p.games >= 1},
  {key: 'ten_matches', title: 'חבר קבוע', desc: '10 הופעות בקבוצה', test: (p: any) => p.games >= 10},
  {key: 'twenty_five', title: 'עמוד תווך', desc: '25 הופעות בקבוצה', test: (p: any) => p.games >= 25},
  {key: 'first_mvp', title: 'MVP ראשון', desc: 'זכייה ראשונה כמצטיין המשחק', test: (p: any) => p.mvp >= 1},
  {key: 'five_mvp', title: 'כוכב הקבוצה', desc: '5 זכיות MVP', test: (p: any) => p.mvp >= 5},
  {key: 'elite_rating', title: 'רמת עילית', desc: 'דירוג ממוצע 4.5 ומעלה', test: (p: any) => p.rating >= 4.5},
];

export default function StatsPage() {
  const [view, setView] = useState<'overview' | 'month' | 'all'>('overview');
  const {user} = useAuth();
  const {data: g} = useGroup();
  const key = ['v2-stats', g?.group.id];
  const {data, isLoading, error} = useQuery({
    queryKey: key,
    enabled: !!g,
    queryFn: async () => {
      const month = new Date().toISOString().slice(0, 10);
      const [membersResult, statsResult, monthlyResult, monthlyGoalsResult, allGoalsResult, cleanSheetsResult] = await Promise.all([
        supabase.from('group_members').select('user_id,profiles(*)').eq('group_id', g!.group.id).eq('status', 'active'),
        supabase.from('player_public_stats').select('*').eq('group_id', g!.group.id),
        supabase.rpc('get_player_of_month', {p_group_id: g!.group.id, p_month: month}),
        supabase.rpc('get_group_goal_leaderboard', {p_group_id: g!.group.id, p_month: month}),
        supabase.rpc('get_group_goal_leaderboard', {p_group_id: g!.group.id, p_month: null}),
        supabase.rpc('get_group_clean_sheet_leaderboard', {p_group_id: g!.group.id}),
      ]);
      const firstError = membersResult.error || statsResult.error || monthlyResult.error || monthlyGoalsResult.error || allGoalsResult.error || cleanSheetsResult.error;
      if (firstError) throw firstError;
      const statsMap = new Map((statsResult.data || []).map((row: any) => [row.user_id, row]));
      const avatarMap = new Map((membersResult.data || []).map((row: any) => [row.user_id, row.profiles?.avatar_url]));
      const withAvatars = (rows: any[] | null) => (rows || []).map(row => ({...row, avatar_url: avatarMap.get(row.user_id)}));
      const rows = (membersResult.data || []).map((member: any) => {
        const stats: any = statsMap.get(member.user_id);
        return {
          id: member.user_id,
          profile: member.profiles,
          rating: Number(stats?.avg_rating ?? member.profiles.base_rating ?? 3),
          ratingCount: Number(stats?.rating_count || 0),
          mvp: Number(stats?.mvp_count || 0),
          games: Number(stats?.games_count || 0),
        };
      });
      return {
        rows,
        monthly: monthlyResult.data?.[0] || null,
        monthlyGoals: withAvatars(monthlyGoalsResult.data),
        allGoals: withAvatars(allGoalsResult.data),
        cleanSheets: withAvatars(cleanSheetsResult.data),
      };
    },
  });

  useRealtimeInvalidation(
    `v2stats-${g?.group.id}`,
    ['profiles', 'player_public_stats', 'match_registrations', 'player_ratings', 'mvp_votes', 'goal_events', 'match_clean_sheet_events', 'matches'],
    [key],
    !!g,
  );

  if (isLoading) return <Card className="stats-loading">טוען את נתוני הקבוצה...</Card>;
  if (error) return <Card className="empty-state"><h2>לא הצלחנו לטעון את הסטטיסטיקות</h2><p>{error.message}</p></Card>;

  const rows = data?.rows || [];
  const byRating = rows.filter((player) => player.ratingCount > 0).sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount || a.id.localeCompare(b.id));
  const byMvp = rows.slice().sort((a, b) => b.mvp - a.mvp || b.rating - a.rating || a.id.localeCompare(b.id));
  const byGames = rows.slice().sort((a, b) => b.games - a.games || b.rating - a.rating || a.id.localeCompare(b.id));
  const monthly: any = data?.monthly;
  const topGoals: any = data?.monthlyGoals?.[0];
  const totalAppearances = rows.reduce((sum, player) => sum + player.games, 0);
  const achievementEntries = rows
    .slice()
    .sort((a, b) => b.games - a.games || b.mvp - a.mvp || b.rating - a.rating)
    .map((player) => ({player, achievement: achievementDefs.filter((achievement) => achievement.test(player)).at(-1)}))
    .filter((entry): entry is {player: typeof rows[number];achievement: typeof achievementDefs[number]} => Boolean(entry.achievement))
    .slice(0, 5);
  const highlights = [
    {title: 'הדירוג הגבוה', player: byRating[0], value: byRating[0]?.rating.toFixed(2) || '0.00'},
    {title: 'מלך ה־MVP', player: byMvp[0], value: byMvp[0]?.mvp || 0},
    {title: 'מלך ההופעות', player: byGames[0], value: byGames[0]?.games || 0},
  ];

  return <div className="stats-page stats-page-v2">
    <Card className="stats-hero stats-hero-v2">
      <div>
        <span className="stats-eyebrow">תמונת מצב קבוצתית</span>
        <h1>המספרים של {g?.group.name}</h1>
        <p>רק משחקים שהסתיימו, שערים מאושרים וזכיית MVP אחת למשחק.</p>
      </div>
      <div className="stats-hero-numbers"><span><strong>{rows.length}</strong>שחקנים פעילים</span><span><strong>{totalAppearances}</strong>סך הופעות</span><span><strong>{byRating[0]?.rating.toFixed(1) || '—'}</strong>דירוג מוביל</span></div>
    </Card>

    <div className="segmented stats-view-tabs" role="tablist" aria-label="תקופת הסטטיסטיקות">
      <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}>סקירה</button>
      <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>החודש</button>
      <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>כל הזמנים</button>
    </div>

    {view === 'month' && (monthly || topGoals) && <section className="stats-awards-grid">
      {monthly && <Card className="player-of-month"><div><span>שחקן החודש</span><h2>{monthly.first_name} {monthly.last_name}</h2><p>דירוגים, זכיות MVP והופעות במשחקים שהסתיימו</p></div><div className="month-score"><strong>{Math.round(Number(monthly.score))}</strong><span>נקודות</span></div></Card>}
      {topGoals && <Card className="player-of-month goal-award"><div><span>מלך השערים החודשי</span><h2>{topGoals.first_name} {topGoals.last_name}</h2><p>רק שערים מאושרים נכנסים לחישוב</p></div><div className="month-score"><strong>{topGoals.goals}</strong><span>שערים</span></div></Card>}
    </section>}

    {view === 'overview' && <section className="stats-highlight-grid stats-highlight-grid-v2">{highlights.map(({title, player, value}, index) => <Card key={title} className={`podium-card rank-${index + 1}`}><b>{String(index + 1).padStart(2, '0')}</b><span>{title}</span><h2>{player ? fullName(player.profile) : '—'}</h2><strong>{value}</strong></Card>)}</section>}

    {view === 'month' && <section className="stats-board-grid single"><GoalBoard title={`שערי ${new Date().toLocaleDateString('he-IL', {month: 'long'})}`} rows={data?.monthlyGoals || []}/></section>}
    {view === 'all' && <section className="stats-board-grid single"><GoalBoard title="שערים בכל הזמנים" rows={data?.allGoals || []}/></section>}

    {view === 'all' && <CleanSheetBoard rows={data?.cleanSheets || []}/>}

    {view === 'overview' && <Card className="stats-list-card">
      <div className="section-title"><div><h2>הישגים בולטים</h2><p>עד חמישה הישגים מובילים מוצגים בכל רגע.</p></div><Badge>מתעדכן אוטומטית</Badge></div>
      <div className="achievement-grid">{achievementEntries.map(({player, achievement}, index) => <Link to={`/players/${player.id}`} key={`${player.id}-${achievement.key}`} className="achievement-card"><b>{String(index + 1).padStart(2, '0')}</b><section><strong>{achievement.title}</strong><span>{fullName(player.profile)}</span><small>{achievement.desc}</small></section></Link>)}</div>
      {!achievementEntries.length && <p className="empty-inline">ההישגים הראשונים ייפתחו אחרי המשחק הבא.</p>}
    </Card>}

    {view === 'all' && <Card className="stats-list-card">
      <div className="section-title"><div><h2>חמישיית המובילים</h2><p>הדירוג קודם; בשוויון מספר הדירוגים מכריע.</p></div><Badge>{Math.min(5, byRating.length)} שחקנים</Badge></div>
      <div className="leaderboard-table">{byRating.slice(0, 5).map((player, index) => <Link to={`/players/${player.id}`} key={player.id} className="leader-row"><b>{index + 1}</b><PlayerAvatar profile={player.profile}/><div><strong className={player.id === user?.id ? 'goal-scorer-me' : undefined}>{fullName(player.profile)}</strong><span>{(player.profile?.preferred_positions || []).join(' · ') || 'שחקן'}</span></div><div className="leader-stats"><span data-label="דירוג">{player.rating.toFixed(2)}</span><span data-label="MVP">{player.mvp}</span><span data-label="משחקים">{player.games}</span></div></Link>)}</div>
      {!byRating.length && <p className="empty-inline">עדיין אין שחקנים שקיבלו דירוג.</p>}
      <RatingLeadersDialog rows={byRating}/>
    </Card>}
  </div>;
}

function GoalBoard({title, rows}: {title: string;rows: any[]}) {
  const {user} = useAuth();
  const scorers = rows.filter((player) => Number(player.goals) > 0);
  const visibleRows = scorers.slice(0, 5);
  return <Card className="stats-list-card">
    <div className="section-title"><div><h2>{title}</h2><p>מוצגים עד חמישת המבקיעים המובילים.</p></div><Badge>{visibleRows.length} מבקיעים</Badge></div>
    <div className="leaderboard-table">{visibleRows.map((player: any, index: number) => <Link to={`/players/${player.user_id}`} key={player.user_id} className="leader-row"><b>{index + 1}</b><PlayerAvatar profile={player} className="player-avatar"/><div><strong className={player.user_id === user?.id ? 'goal-scorer-me' : undefined}>{player.first_name} {player.last_name}</strong><span>שערים מאושרים בלבד</span></div><div className="leader-stats"><span data-label="שערים">{player.goals}</span></div></Link>)}</div>
    {!visibleRows.length && <p className="empty-inline">עדיין אין שערים מאושרים בתקופה זו.</p>}
    <GoalScorersDialog title={title} rows={scorers}/>
  </Card>;
}

function CleanSheetBoard({rows}: {rows: any[]}) {
  const visibleRows = rows.slice(0, 3);
  return <Card className="stats-list-card clean-sheet-board">
    <div className="section-title"><div><h2>טופ 3 שוערים</h2><p>שערים נקיים ממשחקים שהושלמו. אורחים אינם נכנסים לדירוג המצטבר.</p></div><Badge>{visibleRows.length} שוערים</Badge></div>
    <div className="leaderboard-table">{visibleRows.map((player: any, index: number) => <Link to={`/players/${player.user_id}`} key={player.user_id} className="leader-row"><b>{index + 1}</b><PlayerAvatar profile={player} className="player-avatar"/><div><strong>{player.first_name} {player.last_name}</strong><span>{Number(player.matches_with_clean_sheet || 0)} משחקים עם שער נקי</span></div><div className="leader-stats"><span data-label="שערים נקיים">{player.clean_sheets}</span></div></Link>)}</div>
    {!visibleRows.length && <p className="empty-inline">עדיין אין שערים נקיים ממשחקים שהסתיימו.</p>}
  </Card>;
}

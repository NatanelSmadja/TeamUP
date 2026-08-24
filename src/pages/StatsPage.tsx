import {useQuery} from '@tanstack/react-query';
import {Award, CalendarDays, Crown, Flame, Goal, Medal, ShieldCheck, Sparkles, Star, Trophy, Users} from 'lucide-react';
import {Link} from 'react-router-dom';
import {Badge, Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {fullName} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

const achievementDefs = [
  {key: 'first_match', title: 'משחק ראשון', desc: 'הופעה ראשונה ב־TEAMUP', icon: '⚽', test: (p: any) => p.games >= 1},
  {key: 'ten_matches', title: 'חבר קבוע', desc: '10 הופעות בקבוצה', icon: '🔟', test: (p: any) => p.games >= 10},
  {key: 'twenty_five', title: 'עמוד תווך', desc: '25 הופעות בקבוצה', icon: '🧱', test: (p: any) => p.games >= 25},
  {key: 'first_mvp', title: 'MVP ראשון', desc: 'זכייה ראשונה כמצטיין המשחק', icon: '🏆', test: (p: any) => p.mvp >= 1},
  {key: 'five_mvp', title: 'כוכב הקבוצה', desc: '5 זכיות MVP', icon: '⭐', test: (p: any) => p.mvp >= 5},
  {key: 'elite_rating', title: 'רמת עילית', desc: 'דירוג ממוצע 4.5 ומעלה', icon: '🔥', test: (p: any) => p.rating >= 4.5},
];

export default function StatsPage() {
  const {data: g} = useGroup();
  const key = ['v2-stats', g?.group.id];
  const {data, isLoading, error} = useQuery({
    queryKey: key,
    enabled: !!g,
    queryFn: async () => {
      const month = new Date().toISOString().slice(0, 10);
      const [membersResult, statsResult, monthlyResult, monthlyGoalsResult, allGoalsResult] = await Promise.all([
        supabase.from('group_members').select('user_id,profiles(*)').eq('group_id', g!.group.id).eq('status', 'active'),
        supabase.from('player_public_stats').select('*').eq('group_id', g!.group.id),
        supabase.rpc('get_player_of_month', {p_group_id: g!.group.id, p_month: month}),
        supabase.rpc('get_group_goal_leaderboard', {p_group_id: g!.group.id, p_month: month}),
        supabase.rpc('get_group_goal_leaderboard', {p_group_id: g!.group.id, p_month: null}),
      ]);
      const firstError = membersResult.error || statsResult.error || monthlyResult.error || monthlyGoalsResult.error || allGoalsResult.error;
      if (firstError) throw firstError;
      const statsMap = new Map((statsResult.data || []).map((row: any) => [row.user_id, row]));
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
        monthlyGoals: monthlyGoalsResult.data || [],
        allGoals: allGoalsResult.data || [],
      };
    },
  });

  useRealtimeInvalidation(
    `v2stats-${g?.group.id}`,
    ['player_public_stats', 'match_registrations', 'player_ratings', 'mvp_votes', 'goal_events'],
    [key],
    !!g,
  );

  if (isLoading) return <Card className="stats-loading">טוען את נתוני הקבוצה...</Card>;
  if (error) return <Card className="empty-state"><h2>לא הצלחנו לטעון את הסטטיסטיקות</h2><p>{error.message}</p></Card>;

  const rows = data?.rows || [];
  const byRating = rows.slice().sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount || a.id.localeCompare(b.id));
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
    {title: 'הדירוג הגבוה', player: byRating[0], value: byRating[0]?.rating.toFixed(2) || '0.00', Icon: Star},
    {title: 'מלך ה־MVP', player: byMvp[0], value: byMvp[0]?.mvp || 0, Icon: Crown},
    {title: 'מלך ההופעות', player: byGames[0], value: byGames[0]?.games || 0, Icon: Flame},
  ];

  return <div className="stats-page">
    <Card className="stats-hero">
      <div>
        <span className="stats-eyebrow"><Trophy size={15}/>היכל התהילה</span>
        <h1>המספרים של {g?.group.name}</h1>
        <p>רק משחקים שהסתיימו, שערים מאושרים וזכיית MVP אחת למשחק.</p>
      </div>
      <div className="stats-hero-numbers"><span><strong>{rows.length}</strong>שחקנים פעילים</span><span><strong>{totalAppearances}</strong>סך הופעות</span></div>
    </Card>

    {(monthly || topGoals) && <section className="stats-awards-grid">
      {monthly && <Card className="player-of-month"><div className="month-crown"><Crown size={30}/></div><div><span><CalendarDays size={15}/>שחקן החודש</span><h2>{monthly.first_name} {monthly.last_name}</h2><p>דירוגים, זכיות MVP והופעות במשחקים שהסתיימו</p></div><div className="month-score"><strong>{Math.round(Number(monthly.score))}</strong><span>נקודות</span></div></Card>}
      {topGoals && <Card className="player-of-month goal-award"><div className="month-crown"><Goal size={30}/></div><div><span><CalendarDays size={15}/>מלך השערים החודשי</span><h2>{topGoals.first_name} {topGoals.last_name}</h2><p>רק שערים מאושרים נכנסים לחישוב</p></div><div className="month-score"><strong>{topGoals.goals}</strong><span>שערים</span></div></Card>}
    </section>}

    <section className="stats-highlight-grid">{highlights.map(({title, player, value, Icon}, index) => <Card key={title} className={`podium-card rank-${index + 1}`}><div className="stats-highlight-icon"><Icon size={24}/></div><span>{title}</span><h2>{player ? fullName(player.profile) : '—'}</h2><strong>{value}</strong></Card>)}</section>

    <section className="stats-board-grid"><GoalBoard title={`שערי ${new Date().toLocaleDateString('he-IL', {month: 'long'})}`} rows={data?.monthlyGoals || []}/><GoalBoard title="שערים בכל הזמנים" rows={data?.allGoals || []}/></section>

    <Card className="stats-list-card">
      <div className="section-title"><div><h2><Sparkles size={20}/>הישגים בולטים</h2><p>עד חמישה הישגים מובילים מוצגים בכל רגע.</p></div><Badge>מתעדכן אוטומטית</Badge></div>
      <div className="achievement-grid">{achievementEntries.map(({player, achievement}) => <Link to={`/players/${player.id}`} key={`${player.id}-${achievement.key}`} className="achievement-card"><div>{achievement.icon}</div><section><strong>{achievement.title}</strong><span>{fullName(player.profile)}</span><small>{achievement.desc}</small></section><ShieldCheck size={18}/></Link>)}</div>
      {!achievementEntries.length && <p className="empty-inline">ההישגים הראשונים ייפתחו אחרי המשחק הבא.</p>}
    </Card>

    <Card className="stats-list-card">
      <div className="section-title"><div><h2><Trophy size={20}/>חמישיית המובילים</h2><p>הדירוג קודם; בשוויון מספר הדירוגים מכריע.</p></div><Badge>{Math.min(5, byRating.length)} שחקנים</Badge></div>
      <div className="leaderboard-table">{byRating.slice(0, 5).map((player, index) => <Link to={`/players/${player.id}`} key={player.id} className="leader-row"><b>{index < 3 ? [<Trophy key="first"/>, <Medal key="second"/>, <Award key="third"/>][index] : index + 1}</b><div className="player-avatar">{player.profile?.first_name?.[0] || 'ש'}</div><div><strong>{fullName(player.profile)}</strong><span>{(player.profile?.preferred_positions || []).join(' · ') || 'שחקן'}</span></div><div className="leader-stats"><span><Star size={14}/>{player.rating.toFixed(2)}</span><span><Crown size={14}/>{player.mvp}</span><span><Users size={14}/>{player.games}</span></div></Link>)}</div>
      {!byRating.length && <p className="empty-inline">אין עדיין נתוני שחקנים.</p>}
    </Card>
  </div>;
}

function GoalBoard({title, rows}: {title: string;rows: any[]}) {
  const visibleRows = rows.slice(0, 5);
  return <Card className="stats-list-card">
    <div className="section-title"><div><h2><Goal size={20}/>{title}</h2><p>מוצגים עד חמישת המבקיעים המובילים.</p></div><Badge>{visibleRows.length} מבקיעים</Badge></div>
    <div className="leaderboard-table">{visibleRows.map((player: any, index: number) => <Link to={`/players/${player.user_id}`} key={player.user_id} className="leader-row"><b>{index < 3 ? ['🥇', '🥈', '🥉'][index] : index + 1}</b><div className="player-avatar">{player.first_name?.[0] || 'ש'}</div><div><strong>{player.first_name} {player.last_name}</strong><span>שערים מאושרים בלבד</span></div><div className="leader-stats"><span><Goal size={14}/>{player.goals}</span></div></Link>)}</div>
    {!visibleRows.length && <p className="empty-inline">עדיין אין שערים מאושרים בתקופה זו.</p>}
  </Card>;
}

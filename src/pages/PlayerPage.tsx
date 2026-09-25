import {useState, type CSSProperties} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link, useParams} from 'react-router-dom';
import {ArrowRight, ImageDown} from 'lucide-react';
import {Button, Card} from '../components/ui';
import {useGroup} from '../hooks/useGroup';
import {useAuth} from '../contexts/AuthContext';
import {supabase} from '../lib/supabase';
import {footLabel, fullName, positionLabel} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {PlayerBannerDialog} from '../components/PlayerBannerDialog';
import PlayerAvatar from '../components/PlayerAvatar';

export default function PlayerPage() {
  const {id} = useParams();
  const {user} = useAuth();
  const {data: groupSession} = useGroup();
  const [bannerOpen, setBannerOpen] = useState(false);
  const {data, isLoading, isError} = useQuery({
    queryKey: ['player-card', id, groupSession?.group.id],
    enabled: !!id && !!groupSession,
    queryFn: async () => {
      const [{data: profile, error}, {data: stats, error: statsError}, {data: trend, error: trendError}, {data: goalRows, error: goalError}, {data: cleanSheetRows, error: cleanSheetError}] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', id).single(),
        supabase.from('player_public_stats').select('*').eq('group_id', groupSession!.group.id).eq('user_id', id).maybeSingle(),
        supabase.rpc('get_player_rating_trend', {p_user_id: id, p_group_id: groupSession!.group.id}),
        supabase.rpc('get_player_goal_stats', {p_user_id: id, p_group_id: groupSession!.group.id, p_match_id: null}),
        supabase.rpc('get_player_clean_sheet_stats', {p_user_id: id, p_group_id: groupSession!.group.id}),
      ]);
      if (error) throw error;
      if (statsError) throw statsError;
      if (trendError) throw trendError;
      if (goalError) throw goalError;
      if (cleanSheetError) throw cleanSheetError;
      const goals = goalRows?.[0];
      const cleanSheets = cleanSheetRows?.[0];
      return {
        profile,
        ratings: trend || [],
        mvp: Number(stats?.mvp_count || 0),
        games: Number(stats?.games_count || 0),
        avg: Number(stats?.avg_rating ?? profile.base_rating ?? 3),
        ratingCount: Number(stats?.rating_count || 0),
        totalGoals: Number(goals?.total_goals || 0),
        monthlyGoals: Number(goals?.monthly_goals || 0),
        matchGoals: Number(goals?.current_match_goals || 0),
        cleanSheets: Number(cleanSheets?.clean_sheets || 0),
      };
    },
  });

  useRealtimeInvalidation(
    `player-stats-${id}-${groupSession?.group.id}`,
    ['profiles', 'goal_events', 'player_public_stats', 'player_ratings', 'mvp_votes', 'match_registrations', 'match_clean_sheet_events', 'matches'],
    [['player-card', id, groupSession?.group.id]],
    !!id && !!groupSession,
  );

  if (isLoading) return <div className="player-page player-page-v2"><div className="player-profile-skeleton"/><div className="player-stats-skeleton"/></div>;
  if (isError || !data) return <Card className="empty-state"><strong>לא הצלחנו לפתוח את כרטיס השחקן</strong><span>אפשר לחזור לקבוצה ולנסות שוב.</span></Card>;

  const name = fullName(data.profile);
  const positionItems = (data.profile.preferred_positions || [data.profile.preferred_position]).filter(Boolean).map(positionLabel) as string[];
  const positions = positionItems.join(' · ') || 'שחקן';
  const mainPosition = positionItems[0] || 'שחקן';
  const overall = Math.max(20, Math.min(100, Math.round(data.avg * 20)));
  const groupName = groupSession?.group.name || 'הקבוצה שלי';
  const shirtName = data.profile.last_name || data.profile.first_name || 'שחקן';
  const themeColor = groupSession?.group.theme_color || '#7047e8';
  const style = {'--player-color': themeColor, '--overall-value': `${overall * 3.6}deg`} as CSSProperties;
  const primaryStats = [
    {label: 'משחקים', value: data.games, note: 'הופעות בקבוצה'},
    {label: 'שערים', value: data.totalGoals, note: 'בכל המשחקים'},
    {label: 'זכיות MVP', value: data.mvp, note: 'בחירת שחקני הקבוצה'},
    {label: 'שערים נקיים', value: data.cleanSheets, note: 'משחקים ללא ספיגה'},
  ];
  const secondaryStats = [
    {label: 'דירוג ממוצע', value: data.avg.toFixed(2)},
    {label: 'דירוגים שהתקבלו', value: data.ratingCount},
    {label: 'שערים החודש', value: data.monthlyGoals},
    {label: 'במשחק הנוכחי', value: data.matchGoals},
  ];

  return (
    <div className="player-page player-page-v2" style={style}>
      <div className="player-page-actions">
        <Link to={user?.id === id ? '/profile' : '/squad'} className="back-link"><ArrowRight size={17}/>{user?.id === id ? 'חזרה לפרופיל' : 'חזרה לקבוצה'}</Link>
        <Button variant="secondary" onClick={() => setBannerOpen(true)}><ImageDown size={17}/>שמירת כרטיס כתמונה</Button>
      </div>

      <section className="player-profile-hero-v2">
        <div className="player-profile-copy">
          <span className="player-profile-kicker">כרטיס שחקן</span>
          <PlayerAvatar profile={data.profile} className="player-profile-photo"/>
          <h1>{name}</h1>
          <p>{groupName}</p>
          <div className="player-profile-tags">
            {positionItems.length ? positionItems.map((position) => <span key={position}>{position}</span>) : <span>שחקן</span>}
            <span>רגל {footLabel(data.profile.preferred_foot)}</span>
          </div>
        </div>

        <div className="player-full-jersey-wrap" aria-hidden="true">
          <div className="profile-jersey player-full-jersey">
            <span>{groupName}</span>
            <strong>{shirtName}</strong>
            <small>{mainPosition}</small>
          </div>
        </div>

        <div className="player-overall-v2">
          <div><strong>{overall}</strong><span>מתוך 100</span></div>
          <small>ציון כללי</small>
          <p>{data.avg.toFixed(2)} מתוך 5</p>
        </div>
      </section>

      <section className="player-performance-section">
        <header className="player-section-head">
          <div><span>המספרים שלך</span><h2>על המגרש</h2></div>
          <p>הנתונים מתעדכנים אוטומטית ממשחקי הקבוצה.</p>
        </header>
        <div className="player-primary-stats">
          {primaryStats.map((stat, index) => <article key={stat.label} className={index === 1 ? 'featured' : ''}>
            <span>{stat.label}</span><strong>{stat.value}</strong><small>{stat.note}</small>
          </article>)}
        </div>
        <div className="player-secondary-stats">
          {secondaryStats.map((stat) => <div key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}
        </div>
      </section>

      <Card className="player-rating-panel">
        <header className="player-section-head">
          <div><span>מגמה אישית</span><h2>הדירוג לאורך המשחקים</h2></div>
          <p>כל עמודה מציגה ממוצע של משחק. זהות המדרגים אינה מוצגת.</p>
        </header>
        {data.ratings.length ? <>
          <div className="player-chart-scale" aria-hidden="true"><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
          <div className="rating-chart player-rating-chart">
            {data.ratings.slice(-12).map((rating: any, index: number) => <div key={index} title={`${rating.avg_rating}/5 · ${rating.rating_count} דירוגים`}>
              <i style={{height: `${Number(rating.avg_rating) / 5 * 100}%`}}/><span>{Number(rating.avg_rating).toFixed(1)}</span>
            </div>)}
          </div>
        </> : <div className="player-chart-empty"><strong>הדירוג הראשון עוד בדרך</strong><span>אחרי שיתקבלו דירוגים ממשחק, המגמה תופיע כאן.</span></div>}
      </Card>

      <PlayerBannerDialog
        open={bannerOpen}
        onClose={() => setBannerOpen(false)}
        data={{name, position: positions, groupName, overall, rating: data.avg, games: data.games, goals: data.totalGoals, mvp: data.mvp}}
      />
    </div>
  );
}

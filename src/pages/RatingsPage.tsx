import PlayerAvatar from '../components/PlayerAvatar';
import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Check, ChevronLeft, ShieldCheck, Star} from 'lucide-react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {Badge, Button, Card, Select} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {fullName, positionLabel} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

type BoardRow = {id: string;first_name: string;last_name: string;avatar_url?: string | null;avg_rating: number;rating_count: number;mvp_count: number};
type Player = {user_id: string;profiles: any};
type RatingMatch = {id: string;title: string;match_date: string;start_time?: string;ratings_closes_at?: string | null};
const scoreLabels: Record<number, string> = {1: 'חלש', 2: 'מתחת לממוצע', 3: 'טוב', 4: 'טוב מאוד', 5: 'מצוין'};

export default function RatingsPage() {
  const {user} = useAuth();
  const {data: groupSession} = useGroup();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [scores, setScores] = useState<Record<string, number>>({});
  const [mvp, setMvp] = useState('');

  const {data: board = [], isLoading: boardLoading} = useQuery({
    queryKey: ['ratings', groupSession?.group.id],
    enabled: !!groupSession,
    queryFn: async () => {
      const [{data: members, error}, {data: stats, error: statsError}] = await Promise.all([
        supabase.from('group_members').select('user_id,profiles(*)').eq('group_id', groupSession!.group.id).eq('status', 'active'),
        supabase.from('player_public_stats').select('*').eq('group_id', groupSession!.group.id),
      ]);
      if (error) throw error;
      if (statsError) throw statsError;
      const statsMap = new Map((stats || []).map((row: any) => [row.user_id, row]));
      return (members || []).map((member: any) => {
        const stat: any = statsMap.get(member.user_id);
        return {
          id: member.user_id,
          ...member.profiles,
          avg_rating: Number(stat?.avg_rating ?? member.profiles.base_rating ?? 3),
          rating_count: Number(stat?.rating_count || 0),
          mvp_count: Number(stat?.mvp_count || 0),
        };
      }).sort((a: BoardRow, b: BoardRow) => b.avg_rating - a.avg_rating) as BoardRow[];
    },
  });

  const {data: openMatches = [], isLoading: matchesLoading, error: matchesError} = useQuery({
    queryKey: ['open-ratings', groupSession?.group.id, user?.id],
    enabled: !!groupSession && !!user,
    queryFn: async () => {
      const now = new Date().toISOString();
      const {data, error} = await supabase.from('matches').select('id,title,match_date,start_time,ratings_closes_at').eq('group_id', groupSession!.group.id).eq('ratings_open', true).or(`ratings_closes_at.is.null,ratings_closes_at.gt.${now}`).order('match_date', {ascending: false});
      if (error) throw error;
      const ids = (data || []).map((match: RatingMatch) => match.id);
      if (!ids.length) return [];
      const {data: registrations, error: registrationsError} = await supabase.from('match_registrations').select('match_id').eq('user_id', user!.id).eq('registration_status', 'confirmed').eq('attended', true).in('match_id', ids);
      if (registrationsError) throw registrationsError;
      const allowed = new Set((registrations || []).map((registration: any) => registration.match_id));
      return (data || []).filter((match: RatingMatch) => allowed.has(match.id)) as RatingMatch[];
    },
  });

  const active = useMemo(() => openMatches.find((match) => match.id === selected) || openMatches[0], [openMatches, selected]);
  useEffect(() => {
    if (active && !selected) setSelected(active.id);
  }, [active, selected]);

  const {data: players = [], isLoading: playersLoading} = useQuery({
    queryKey: ['rating-players', active?.id, user?.id],
    enabled: !!active && !!user,
    queryFn: async () => {
      const {data: registrations, error} = await supabase.from('match_registrations').select('user_id').eq('match_id', active!.id).eq('registration_status', 'confirmed').eq('attended', true).neq('user_id', user!.id);
      if (error) throw error;
      const ids = (registrations || []).map((registration: any) => registration.user_id);
      if (!ids.length) return [];
      const {data: profiles, error: profileError} = await supabase.from('profiles').select('id,first_name,last_name,preferred_positions,preferred_position,avatar_url').in('id', ids);
      if (profileError) throw profileError;
      const profileMap = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      return ids.map((id: string) => ({user_id: id, profiles: profileMap.get(id)})).filter((player) => player.profiles) as Player[];
    },
  });

  const {data: existing} = useQuery({
    queryKey: ['my-ratings', active?.id, user?.id],
    enabled: !!active && !!user,
    queryFn: async () => {
      const [{data: ratings, error}, {data: vote, error: voteError}] = await Promise.all([
        supabase.from('player_ratings').select('rated_user_id,overall_rating').eq('match_id', active!.id).eq('rater_user_id', user!.id),
        supabase.from('mvp_votes').select('voted_user_id').eq('match_id', active!.id).eq('voter_user_id', user!.id).maybeSingle(),
      ]);
      if (error) throw error;
      if (voteError) throw voteError;
      return {ratings: ratings || [], vote};
    },
  });

  useEffect(() => {
    if (!existing) return;
    setScores(Object.fromEntries(existing.ratings.map((rating: any) => [rating.rated_user_id, rating.overall_rating])));
    setMvp(existing.vote?.voted_user_id || '');
  }, [existing, active?.id]);

  useRealtimeInvalidation(
    `ratings-${groupSession?.group.id}`,
    ['profiles', 'player_ratings', 'mvp_votes', 'player_public_stats', 'matches'],
    [['ratings', groupSession?.group.id], ['open-ratings', groupSession?.group.id, user?.id], ['my-ratings', active?.id, user?.id]],
    !!groupSession,
  );

  const submit = useMutation({
    mutationFn: async () => {
      if (!active) throw new Error('בחר משחק');
      const rows = players.filter((player) => scores[player.user_id]).map((player) => ({user_id: player.user_id, score: scores[player.user_id]}));
      if (!rows.length) throw new Error('בחר ציון לפחות לשחקן אחד');
      const {error} = await supabase.rpc('submit_match_ratings', {p_match_id: active.id, p_ratings: rows, p_mvp_user_id: mvp || null});
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(mvp ? 'הדירוג והצבעת ה־MVP נשמרו' : 'הדירוג נשמר');
      queryClient.invalidateQueries({queryKey: ['ratings']});
      queryClient.invalidateQueries({queryKey: ['my-ratings']});
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const completed = players.filter((player) => scores[player.user_id]).length;
  const progress = players.length ? Math.round(completed / players.length * 100) : 0;

  return <div className="ratings-page-v2 space-y-5">
    <section className="ratings-hero-v2">
      <div>
        <span>אחרי המשחק</span>
        <h1>דירוגים ו־MVP</h1>
        <p>מדרגים רק את מי ששיחק איתך. השחקנים רואים ממוצעים בלבד.</p>
      </div>
      {active && <div className="ratings-progress-ring" style={{'--rating-progress': `${progress * 3.6}deg`} as CSSProperties}>
        <strong>{completed}/{players.length}</strong><span>דורגו</span>
      </div>}
    </section>

    <div className="ratings-privacy-note"><ShieldCheck size={19}/><div><strong>הדירוג נשאר פרטי</strong><p>זהות המדרגים אינה מוצגת לשחקנים או בטבלאות הקבוצה.</p></div></div>

    {matchesLoading ? <div className="ratings-loading-list"><i/><i/><i/></div> : matchesError ? <Card className="empty-state"><h2>לא הצלחנו לטעון את המשחקים</h2><p>{matchesError.message}</p></Card> : openMatches.length > 0 ? <Card className="rating-workspace rating-workspace-v2">
      <div className="rating-match-bar">
        <div><span>המשחק שמדרגים</span><strong>{active?.title}</strong><small>{active && new Date(`${active.match_date}T12:00:00`).toLocaleDateString('he-IL', {day: 'numeric', month: 'long', year: 'numeric'})}</small></div>
        <Select value={active?.id || ''} onChange={(event) => {setSelected(event.target.value);setScores({});setMvp('')}}>
          {openMatches.map((match) => <option key={match.id} value={match.id}>{match.title} · {new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL')}</option>)}
        </Select>
      </div>

      {playersLoading ? <div className="ratings-loading-list"><i/><i/><i/></div> : players.length === 0 ? <div className="empty-state"><h3>אין שחקנים נוספים לדירוג</h3><p>רק משתתפים מאושרים שסומנו כנוכחים מופיעים כאן.</p></div> : <>
        <div className="rating-player-grid rating-player-grid-v2">
          {players.map((player, index) => {
            const value = scores[player.user_id];
            const playerPositions = (player.profiles.preferred_positions || [player.profiles.preferred_position]).filter(Boolean).map(positionLabel).join(' · ') || 'ללא עמדה';
            return <article key={player.user_id} className={`rating-player-card ${value ? 'rated' : ''}`}>
              <div className="rating-player-head">
                <span className="rating-card-index">{String(index + 1).padStart(2, '0')}</span>
                <PlayerAvatar profile={player.profiles} className="player-avatar"/>
                <div><h3>{fullName(player.profiles)}</h3><p>{playerPositions}</p></div>
                {value && <span className="rating-complete-mark"><Check size={15}/></span>}
              </div>
              <div className="score-picker" aria-label={`דירוג ${fullName(player.profiles)}`}>
                {[1, 2, 3, 4, 5].map((score) => <button key={score} type="button" className={value === score ? 'active' : ''} title={`${score} - ${scoreLabels[score]}`} onClick={() => setScores((current) => ({...current, [player.user_id]: score}))}>
                  <Star size={16} fill={value === score ? 'currentColor' : 'none'}/><span>{score}</span>
                </button>)}
              </div>
              <small className="score-description">{value ? scoreLabels[value] : 'בחר ציון מ־1 עד 5'}</small>
            </article>;
          })}
        </div>

        <section className="mvp-section mvp-section-v2">
          <header><div><span>בחירה אחת</span><h3>מי היה שחקן המשחק?</h3><p>הצבעת ה־MVP פרטית ואי אפשר לבחור את עצמך.</p></div>{mvp && <Badge>נבחר</Badge>}</header>
          <div className="mvp-grid">{players.map((player) => <button type="button" key={player.user_id} className={mvp === player.user_id ? 'active' : ''} onClick={() => setMvp(player.user_id)}><span>{player.profiles.first_name?.[0] || 'ש'}</span><strong>{fullName(player.profiles)}</strong>{mvp === player.user_id && <Check size={15}/>}</button>)}</div>
        </section>

        <div className="rating-submit-bar">
          <div><strong>{completed === players.length ? 'סיימת לדרג את כולם' : `נשארו ${players.length - completed} שחקנים`}</strong><p>אפשר לשמור דירוג חלקי ולהמשיך אחר כך.</p></div>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending || completed === 0}>{submit.isPending ? 'שומר...' : 'שמירת דירוגים'}</Button>
        </div>
      </>}
    </Card> : <Card className="empty-state ratings-closed-state"><h2>אין כרגע משחק פתוח לדירוג</h2><p>לאחר משחק שהשתתפת בו, המנהל יפתח את הדירוג והוא יופיע כאן.</p></Card>}

    <section className="rating-leaderboard rating-leaderboard-v2">
      <div className="rating-leaderboard-heading"><div><small>טבלת הקבוצה</small><h2>הדירוג הנוכחי</h2><p>הממוצע מבוסס על דירוגים שנשלחו לאחר משחקים.</p></div><Badge>{board.length} שחקנים</Badge></div>
      {boardLoading ? <div className="ratings-loading-list"><i/><i/><i/></div> : <div className="rating-board-list">
        {board.map((player, index) => {
          const name = `${player.first_name || ''} ${player.last_name || ''}`.trim() || 'שחקן';
          return <Link to={`/players/${player.id}`} key={player.id} className={`rating-board-row rank-${index + 1}`}>
            <div className="rating-rank-mark" aria-label={`מקום ${index + 1}`}>{index + 1}</div>
            <PlayerAvatar profile={player} className="rating-board-avatar"/>
            <div className="rating-board-player"><h3>{name}{player.id === user?.id && <small>אני</small>}</h3><div><span>{player.rating_count} דירוגים</span><span>{player.mvp_count} זכיות MVP</span></div></div>
            <div className="rating-board-score"><small>ממוצע</small><strong>{player.avg_rating.toFixed(1)}</strong></div>
            <ChevronLeft className="rating-board-arrow" size={18}/>
          </Link>;
        })}
        {!board.length && <div className="player-chart-empty"><strong>הטבלה עדיין ריקה</strong><span>היא תתעדכן לאחר שליחת הדירוגים הראשונים.</span></div>}
      </div>}
    </section>
  </div>;
}

import {useEffect, useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ChevronDown, Crown, Eye, ShieldCheck, Star, UserCheck, Users} from 'lucide-react';
import {Badge, Card, Select} from './ui';
import {supabase} from '../lib/supabase';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

type AuditMatch = {
  match_id: string;
  title: string;
  match_date: string;
  status: string;
  ratings_open: boolean;
  rating_entries: number;
  distinct_raters: number;
  mvp_ballots: number;
  attended_players: number;
};

type RatingEntry = {
  id: string;
  rater_user_id: string;
  rater_name: string;
  rated_user_id: string;
  rated_name: string;
  overall_rating: number;
  created_at: string;
};

type MvpBallot = {
  id: string;
  voter_user_id: string;
  voter_name: string;
  voted_user_id: string;
  voted_name: string;
  created_at: string;
};

type AuditDetails = {
  match: {id: string;title: string;match_date: string;status: string;ratings_open: boolean;ratings_closes_at?: string | null};
  attended_count: number;
  ratings: RatingEntry[];
  mvp_votes: MvpBallot[];
};

const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('he-IL', {day: 'numeric', month: 'long', year: 'numeric'});

export function RatingAuditPanel({groupId, matchId}: {groupId: string;matchId?: string}) {
  const [selectedMatch, setSelectedMatch] = useState(matchId || '');
  const matchesKey = ['rating-audit-matches', groupId] as const;
  const {data: matches = [], isLoading: matchesLoading, error: matchesError} = useQuery({
    queryKey: matchesKey,
    enabled: !matchId,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('get_group_rating_audit_matches', {p_group_id: groupId});
      if (error) throw error;
      return (data || []) as AuditMatch[];
    },
  });

  useEffect(() => {
    if (matchId) {
      if (selectedMatch !== matchId) setSelectedMatch(matchId);
      return;
    }
    if (!matchesLoading && !matches.length && selectedMatch) setSelectedMatch('');
    else if (!selectedMatch && matches[0]) setSelectedMatch(matches[0].match_id);
    else if (selectedMatch && matches.length && !matches.some((match) => match.match_id === selectedMatch)) setSelectedMatch(matches[0].match_id);
  }, [matchId, matches, matchesLoading, selectedMatch]);

  const detailsKey = ['rating-audit-details', selectedMatch] as const;
  const {data: details, isLoading: detailsLoading, error: detailsError} = useQuery({
    queryKey: detailsKey,
    enabled: !!selectedMatch,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('get_match_rating_audit', {p_match_id: selectedMatch});
      if (error) throw error;
      return data as AuditDetails;
    },
  });

  useRealtimeInvalidation(
    `rating-audit-${groupId}`,
    ['player_ratings', 'mvp_votes', 'matches'],
    [matchesKey, detailsKey],
    true,
  );

  const selectedSummary = matches.find((match) => match.match_id === selectedMatch);
  const raterGroups = useMemo(() => {
    const groups = new Map<string, {id: string;name: string;ratings: RatingEntry[];mvp?: MvpBallot}>();
    for (const rating of details?.ratings || []) {
      const current = groups.get(rating.rater_user_id) || {id: rating.rater_user_id, name: rating.rater_name, ratings: []};
      current.ratings.push(rating);
      groups.set(rating.rater_user_id, current);
    }
    for (const vote of details?.mvp_votes || []) {
      const current = groups.get(vote.voter_user_id) || {id: vote.voter_user_id, name: vote.voter_name, ratings: []};
      current.mvp = vote;
      groups.set(vote.voter_user_id, current);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [details]);

  const summary = matchId && details ? {
    attended_players: details.attended_count,
    distinct_raters: new Set(details.ratings.map((rating) => rating.rater_user_id)).size,
    rating_entries: details.ratings.length,
    mvp_ballots: details.mvp_votes.length,
  } : selectedSummary;

  return <section className="rating-audit-workspace">
    <Card className="rating-audit-intro">
      <div className="rating-audit-intro-icon"><Eye size={24}/></div>
      <div><Badge>גישה מוגבלת</Badge><h2>{matchId ? 'ביקורת דירוגי המשחק' : 'ביקורת דירוגים'}</h2><p>מידע אישי לצורכי בקרה בלבד. רק מנהל הקבוצה או מי שקיבל הרשאת צפייה בפירוט דירוגים יכול לפתוח את האזור הזה.</p></div>
      <ShieldCheck size={24}/>
    </Card>

    {!matchId && <Card className="rating-audit-picker">
      <div><span>בחירת משחק</span><strong>{selectedSummary ? `${selectedSummary.title} · ${dateLabel(selectedSummary.match_date)}` : 'אין משחקים עם דירוגים'}</strong></div>
      <Select value={selectedMatch} onChange={(event) => setSelectedMatch(event.target.value)} disabled={matchesLoading || !matches.length} aria-label="בחירת משחק לביקורת דירוגים">
        {!matches.length && <option value="">אין משחקים להצגה</option>}
        {matches.map((match) => <option key={match.match_id} value={match.match_id}>{match.title} · {dateLabel(match.match_date)}</option>)}
      </Select>
    </Card>}

    {!matchId && matchesError && <Card className="empty-state"><h2>לא ניתן לטעון את ביקורת הדירוגים</h2><p>{matchesError.message}</p></Card>}
    {!matchId && !matchesLoading && !matchesError && !matches.length && <Card className="empty-state"><Star size={32}/><h2>עדיין אין דירוגים לביקורת</h2><p>לאחר סיום משחק והגשת הדירוגים הם יופיעו כאן.</p></Card>}

    {summary && <div className="rating-audit-kpis">
      <Card><Users/><strong>{Number(summary.attended_players || 0)}</strong><span>שחקנים שנכחו</span></Card>
      <Card><UserCheck/><strong>{Number(summary.distinct_raters || 0)}</strong><span>מדרגים שהגישו</span></Card>
      <Card><Star/><strong>{Number(summary.rating_entries || 0)}</strong><span>דירוגים שניתנו</span></Card>
      <Card><Crown/><strong>{Number(summary.mvp_ballots || 0)}</strong><span>הצבעות MVP</span></Card>
    </div>}

    {detailsLoading && <Card className="rating-audit-loading">טוען את פירוט הדירוגים...</Card>}
    {detailsError && <Card className="empty-state"><h2>לא ניתן לפתוח את המשחק</h2><p>{detailsError.message}</p></Card>}
    {details && !detailsLoading && <Card className="rating-audit-list-card">
      <div className="section-title"><div><h2><Eye size={20}/>פירוט לפי מדרג</h2><p>כל כרטיס סגור כברירת מחדל. פתח רק את המדרג שברצונך לבדוק.</p></div><Badge>{raterGroups.length} מדרגים</Badge></div>
      <div className="rating-audit-raters">
        {raterGroups.map((rater) => {
          const average = rater.ratings.length ? rater.ratings.reduce((sum, rating) => sum + Number(rating.overall_rating), 0) / rater.ratings.length : 0;
          return <details key={rater.id} className="rating-audit-rater">
            <summary>
              <div className="player-avatar">{rater.name[0] || 'ש'}</div>
              <div><strong>{rater.name}</strong><span>{rater.ratings.length} דירוגים{rater.mvp ? ` · MVP: ${rater.mvp.voted_name}` : ' · ללא בחירת MVP'}</span></div>
              <div className="rating-audit-summary-score"><Star size={15}/>{average ? average.toFixed(1) : '—'}</div>
              <ChevronDown className="rating-audit-chevron" size={18}/>
            </summary>
            <div className="rating-audit-rater-body">
              {rater.mvp && <div className="rating-audit-mvp"><Crown size={18}/><span>בחירת ה־MVP של {rater.name}</span><strong>{rater.mvp.voted_name}</strong></div>}
              <div className="rating-audit-given-list">
                {rater.ratings.map((rating) => <div key={rating.id} className="rating-audit-given-row">
                  <div><span>דירג את</span><strong>{rating.rated_name}</strong></div>
                  <Score value={Number(rating.overall_rating)}/>
                </div>)}
                {!rater.ratings.length && <p className="empty-inline">לא הוגשו ציונים; קיימת רק בחירת MVP.</p>}
              </div>
            </div>
          </details>;
        })}
        {!raterGroups.length && <div className="rating-audit-empty"><Star size={25}/><div><strong>עדיין לא הוגשו דירוגים</strong><span>הנתונים יתעדכנו כאן בזמן אמת.</span></div></div>}
      </div>
    </Card>}
  </section>;
}

function Score({value}: {value: number}) {
  return <div className="rating-audit-score" aria-label={`ציון ${value} מתוך 5`}>
    <div>{[1, 2, 3, 4, 5].map((score) => <i key={score} className={score <= value ? 'active' : ''}/>)}</div>
    <strong>{value.toFixed(1)}</strong>
  </div>;
}

import {useQuery} from '@tanstack/react-query';
import {Crown} from 'lucide-react';
import PlayerAvatar from './PlayerAvatar';
import {Badge, Card} from './ui';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {supabase} from '../lib/supabase';
import type {Match} from '../types';

type VoteTotal = {user_id: string; first_name: string; last_name: string; avatar_url: string | null; vote_count: number};

export default function MatchMvpVoteResults({match}: {match: Match}) {
  const votingClosed = !match.ratings_open || Boolean(match.ratings_closes_at && new Date(match.ratings_closes_at).getTime() <= Date.now());
  const key = ['match-mvp-vote-totals', match.id];
  const {data: votes = [], isLoading, error} = useQuery({
    queryKey: key,
    enabled: votingClosed,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('get_match_mvp_vote_totals', {p_match_id: match.id});
      if (error) throw error;
      return (data || []) as VoteTotal[];
    },
  });
  useRealtimeInvalidation(`match-mvp-votes-${match.id}`, ['mvp_votes', 'matches'], [key], votingClosed);
  const total = votes.reduce((sum, player) => sum + Number(player.vote_count), 0);

  return <Card className="match-mvp-results">
    <div className="section-title"><div><h2><Crown size={20}/>הצבעות MVP במשחק הזה</h2><p>מספר הקולות שכל שחקן קיבל במשחק הזה בלבד. זהות המצביעים נשארת פרטית.</p></div>{votingClosed && <Badge>{total} קולות בסך הכול</Badge>}</div>
    {!votingClosed ? <p className="empty-inline">התוצאות יופיעו לאחר סגירת הדירוגים.</p>
      : isLoading ? <p className="empty-inline">טוען את תוצאות ההצבעה...</p>
      : error ? <p className="empty-inline">לא הצלחנו לטעון את תוצאות ההצבעה.</p>
      : votes.length ? <div className="match-mvp-vote-list">{votes.map(player => <div className="match-mvp-vote-row" key={player.user_id}>
        <PlayerAvatar profile={player} className="player-avatar sm"/>
        <strong>{`${player.first_name || ''} ${player.last_name || ''}`.trim() || 'שחקן'}</strong>
        <span>{player.vote_count} {Number(player.vote_count) === 1 ? 'קול' : 'קולות'}</span>
      </div>)}</div>
      : <p className="empty-inline">לא נרשמו הצבעות MVP במשחק הזה.</p>}
  </Card>;
}

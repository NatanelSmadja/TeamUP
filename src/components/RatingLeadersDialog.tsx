import {useId, useRef} from 'react';
import {Link} from 'react-router-dom';
import {Star, X} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {Button} from './ui';

type RatedPlayer = {
  id: string;
  profile: {first_name?: string; last_name?: string} | null;
  rating: number;
  ratingCount: number;
};

export default function RatingLeadersDialog({rows}: {rows: RatedPlayer[]}) {
  const {user} = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const players = rows.filter((player) => player.ratingCount > 0).sort((a, b) =>
    b.rating - a.rating || b.ratingCount - a.ratingCount || a.id.localeCompare(b.id));
  const hasRating = players.some((player) => player.id === user?.id);

  return <>
    <Button variant="secondary" className="goal-scorers-more" onClick={() => dialog.current?.showModal()}>הראה עוד</Button>
    <dialog ref={dialog} className="goal-scorers-dialog" aria-labelledby={titleId} dir="rtl" onClick={(event) => {
      if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }
    }}>
      <div className="goal-scorers-heading"><div><h2 id={titleId}>דירוג השחקנים</h2><p>כל השחקנים שקיבלו דירוג · בשוויון מספר הדירוגים מכריע</p></div><Button variant="ghost" aria-label="סגירה" onClick={() => dialog.current?.close()}><X size={20}/></Button></div>
      {user && !hasRating && <p className="goal-scorers-personal">עדיין לא קיבלת דירוג</p>}
      <div className="leaderboard-table">{players.map((player, index) => <Link to={`/players/${player.id}`} key={player.id} className="leader-row" onClick={() => dialog.current?.close()}>
        <b>{index + 1}</b><div className="player-avatar">{player.profile?.first_name?.[0] || 'ש'}</div><div><strong className={player.id === user?.id ? 'goal-scorer-me' : undefined}>{player.profile?.first_name} {player.profile?.last_name}{player.id === user?.id && ' (אני)'}</strong><span>{player.ratingCount} דירוגים</span></div><div className="leader-stats"><span aria-label={`דירוג ממוצע ${player.rating.toFixed(2)}`}><Star size={14}/>{player.rating.toFixed(2)}</span></div>
      </Link>)}</div>
      {!players.length && <p className="empty-inline">עדיין אין שחקנים שקיבלו דירוג.</p>}
    </dialog>
  </>;
}

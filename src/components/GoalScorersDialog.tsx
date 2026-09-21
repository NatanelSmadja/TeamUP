import {useId, useRef} from 'react';
import {Link} from 'react-router-dom';
import {X} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {Button} from './ui';

type GoalScorer = {user_id: string; first_name: string; last_name: string; goals: number | string};

export default function GoalScorersDialog({rows, title}: {rows: GoalScorer[]; title: string}) {
  const {user} = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const scorers = rows.filter((player) => Number(player.goals) > 0)
    .slice().sort((a, b) => Number(b.goals) - Number(a.goals));
  const hasScored = scorers.some((player) => player.user_id === user?.id);

  return <>
    <Button variant="secondary" className="goal-scorers-more" onClick={() => dialog.current?.showModal()}>הראה עוד</Button>
    <dialog ref={dialog} className="goal-scorers-dialog" aria-labelledby={titleId} dir="rtl" onClick={(event) => {
      if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }
    }}>
      <div className="goal-scorers-heading"><div><h2 id={titleId}>{title}</h2><p>כל השחקנים שהבקיעו · שערים מאושרים בלבד</p></div><Button variant="ghost" aria-label="סגירה" onClick={() => dialog.current?.close()}><X size={20}/></Button></div>
      {user && !hasScored && <p className="goal-scorers-personal">לא הבקעת בכלל</p>}
      <div className="leaderboard-table">{scorers.map((player, index) => <Link to={`/players/${player.user_id}`} key={player.user_id} className="leader-row" onClick={() => dialog.current?.close()}>
        <b>{index + 1}</b><div className="player-avatar">{player.first_name?.[0] || 'ש'}</div><div><strong className={player.user_id === user?.id ? 'goal-scorer-me' : undefined}>{player.first_name} {player.last_name}{player.user_id === user?.id && ' (אני)'}</strong></div><div className="leader-stats"><span data-label="שערים">{player.goals}</span></div>
      </Link>)}</div>
      {!scorers.length && <p className="empty-inline">עדיין אין שערים מאושרים בתקופה זו.</p>}
    </dialog>
  </>;
}

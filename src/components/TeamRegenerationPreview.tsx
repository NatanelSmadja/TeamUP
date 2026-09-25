import {useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {Button} from './ui';
import {PlayerBalanceRating, TeamRatingSummary} from './TeamRatingSummary';
import {fullName} from '../lib/utils';

export type RegenerationPlan = {
  status: 'balanced' | 'less_balanced' | 'no_alternative';
  expected_state: string;
  candidate_signature: string;
  current_balance: number;
  candidate_balance: number;
  teams: any[];
  allocation: any[];
};

export default function TeamRegenerationPreview({plan, teamSize, busy, onPublish, onCancel}: {
  plan: RegenerationPlan; teamSize: number; busy: boolean; onPublish: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element?.showModal();
    return () => {element?.close(); document.body.style.overflow = overflow;};
  }, []);
  return createPortal(<dialog ref={dialog} className="regeneration-preview" aria-labelledby="regeneration-preview-title" onCancel={event => {event.preventDefault(); if (!busy) onCancel();}}>
    <h2 id="regeneration-preview-title">חלופה פחות מאוזנת — תצוגה מקדימה</h2>
    <p>החלוקה הקיימת עדיין בתוקף. החלופה תפורסם רק לאחר אישור.</p>
    <p>דמיון בדירוגים: {Number(plan.current_balance).toFixed(2)}% בחלוקה הקיימת ← {Number(plan.candidate_balance).toFixed(2)}% בחלופה. המדד משווה ממוצעים בלבד.</p>
    <div className="regeneration-preview-teams">
      {plan.teams.map(team => {
        const players = plan.allocation.filter(player => player.team_number === team.team_number);
        return <section key={team.id}>
          <h3>{team.name} · {players.length} שחקנים</h3>
          <TeamRatingSummary team={{team_players: players}} teamSize={teamSize} showRatings/>
          <ul>{players.map(player => <li key={player.id}>{player.guest?.display_name || fullName(player.profiles)} <PlayerBalanceRating player={player} visible/>{player.guest && <small> אורח</small>}</li>)}</ul>
        </section>;
      })}
    </div>
    <footer><Button onClick={onPublish} disabled={busy}>{busy ? 'מפרסם...' : 'אישור ופרסום החלופה'}</Button><Button variant="secondary" onClick={onCancel} disabled={busy}>חזרה לחלוקה הקיימת</Button></footer>
  </dialog>, document.body);
}

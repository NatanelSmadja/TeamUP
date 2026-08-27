import {useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Eye, FastForward, RefreshCcw, Share2, ShieldCheck, Sparkles, X} from 'lucide-react';
import type {Match} from '../types';
import {positionLabel} from '../lib/utils';
import {Badge, Button} from './ui';

type RevealPhase = 'intro' | 'locking' | 'team' | 'final';

const teamPalette: Record<string, {color: string;soft: string}> = {
  red: {color: '#ef5f6d', soft: 'rgba(239,95,109,.16)'},
  blue: {color: '#5b8cff', soft: 'rgba(91,140,255,.17)'},
  yellow: {color: '#f5c451', soft: 'rgba(245,196,81,.16)'},
  green: {color: '#36d3ad', soft: 'rgba(54,211,173,.16)'},
};

const teamNames: Record<string, string> = {
  red: 'האדומים',
  blue: 'הכחולים',
  yellow: 'הצהובים',
  green: 'הירוקים',
};

const playerName = (player: any) => player.guest?.display_name || [player.profiles?.first_name, player.profiles?.last_name].filter(Boolean).join(' ') || 'שחקן';
const playerPosition = (player: any) => player.assigned_position || player.guest?.preferred_position || player.profiles?.preferred_position;

export default function TeamReveal({match, teams, balance, open, onClose, onShare}: {
  match: Match;
  teams: any[];
  balance: number;
  open: boolean;
  onClose: () => void;
  onShare: () => void | Promise<void>;
}) {
  const [phase, setPhase] = useState<RevealPhase>('intro');
  const [teamIndex, setTeamIndex] = useState(0);
  const [visiblePlayers, setVisiblePlayers] = useState(0);
  const timers = useRef<number[]>([]);
  const onCloseRef = useRef(onClose);
  const reducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const orderedTeams = useMemo(() => teams.slice().sort((a, b) => Number(a.team_number || 0) - Number(b.team_number || 0)), [teams]);
  const currentTeam = orderedTeams[teamIndex];
  const palette = teamPalette[currentTeam?.color_key] || {color: '#5b8cff', soft: 'rgba(91,140,255,.17)'};
  const progress = phase === 'intro' ? 0 : phase === 'locking' ? 9 : phase === 'final' ? 100 : Math.round(15 + ((teamIndex + visiblePlayers / Math.max(currentTeam?.team_players?.length || 1, 1)) / Math.max(orderedTeams.length, 1)) * 80);

  const clearTimers = () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  };
  const later = (callback: () => void, delay: number) => {
    timers.current.push(window.setTimeout(callback, reducedMotion ? Math.min(delay, 40) : delay));
  };

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', closeOnEscape);
      clearTimers();
    };
  }, [open]);

  useEffect(() => {
    if (!open || phase !== 'team' || !currentTeam) return;
    const playerCount = currentTeam.team_players?.length || 0;
    if (visiblePlayers < playerCount) {
      later(() => setVisiblePlayers((count) => count + 1), 390);
      return clearTimers;
    }
    later(() => {
      if (teamIndex < orderedTeams.length - 1) {
        setTeamIndex((index) => index + 1);
        setVisiblePlayers(0);
      } else {
        setPhase('final');
      }
    }, 850);
    return clearTimers;
  }, [currentTeam, open, orderedTeams.length, phase, teamIndex, visiblePlayers]);

  const start = () => {
    clearTimers();
    setTeamIndex(0);
    setVisiblePlayers(0);
    setPhase('locking');
    later(() => setPhase('team'), 1250);
  };
  const close = () => {
    clearTimers();
    setPhase('intro');
    setTeamIndex(0);
    setVisiblePlayers(0);
    onClose();
  };
  const skip = () => {
    clearTimers();
    setPhase('final');
  };

  if (!open || !orderedTeams.length) return null;

  return createPortal(<div className="team-reveal-layer" role="dialog" aria-modal="true" aria-label="חשיפת הקבוצות">
    <div className="team-reveal-shell">
      <header className="team-reveal-topbar">
        <div className="team-reveal-brand"><img src="/brand/teamup-logo-128.png" alt=""/><span><small>{match.title}</small><strong>הקבוצות מוכנות</strong></span></div>
        <div className="team-reveal-top-actions">
          {phase !== 'intro' && phase !== 'final' && <button onClick={skip}><FastForward size={16}/><span>דלג לתוצאה</span></button>}
          <button onClick={close} aria-label="סגירת חשיפת הקבוצות"><X size={20}/></button>
        </div>
      </header>
      <div className="team-reveal-progress" aria-hidden="true"><i style={{width: `${progress}%`}}/></div>

      <main className={`team-reveal-stage phase-${phase}`} style={{'--reveal-color': palette.color, '--reveal-soft': palette.soft} as React.CSSProperties}>
        {phase === 'intro' && <section className="team-reveal-intro">
          <span className="team-reveal-eyebrow"><Sparkles size={14}/> TEAM REVEAL</span>
          <div className="team-reveal-ball">⚽</div>
          <h1>הרגע שכולם חיכו לו</h1>
          <p>{orderedTeams.reduce((sum, team) => sum + (team.team_players?.length || 0), 0)} שחקנים, {orderedTeams.length} קבוצות וחלוקה אחת מאוזנת.<br/>מוכנים לגלות עם מי אתם משחקים?</p>
          <Button onClick={start}>חשיפת הקבוצות <span>←</span></Button>
          <small>החלוקה פורסמה על ידי מנהל הקבוצה</small>
        </section>}

        {phase === 'locking' && <section className="team-reveal-locking">
          <div className="team-balance-wheel"><span>⚖</span></div>
          <span className="team-reveal-eyebrow">TEAMUP BALANCE</span>
          <h1>נועלים את ההרכבים</h1>
          <p>מסדרים את הקבוצות לפי הדירוגים, העמדות ורמת האיזון...</p>
        </section>}

        {phase === 'team' && currentTeam && <section className="team-reveal-current" key={currentTeam.id}>
          <div className="team-reveal-aura"/>
          <span className="team-reveal-number">קבוצה {teamIndex + 1} מתוך {orderedTeams.length}</span>
          <h1>{teamNames[currentTeam.color_key] || currentTeam.name}</h1>
          <p>ההרכב שלכם למשחק</p>
          <div className="team-reveal-lineup">
            {(currentTeam.team_players || []).map((player: any, index: number) => <article className={index < visiblePlayers ? 'is-visible' : ''} key={player.id}>
              <span className="team-reveal-avatar">{playerName(player)[0]}</span>
              <div><strong>{playerName(player)}</strong><small>{positionLabel(playerPosition(player))}{player.guest ? ' · אורח' : ''}</small></div>
              <b>{index + 1}</b>
            </article>)}
          </div>
          <div className="team-reveal-dots">{orderedTeams.map((team, index) => <i key={team.id} className={index < teamIndex ? 'done' : index === teamIndex ? 'current' : ''}/>)}</div>
        </section>}

        {phase === 'final' && <section className="team-reveal-final">
          <div className="team-reveal-final-head">
            <span><ShieldCheck size={16}/> איזון קבוצות {balance}%</span>
            <h1>הכול מוכן לשריקה</h1>
            <p>{orderedTeams.length} הקבוצות של {match.title}</p>
          </div>
          <div className="team-reveal-grid">
            {orderedTeams.map((team) => {
              const teamColor = teamPalette[team.color_key]?.color || '#5b8cff';
              return <article key={team.id} style={{'--team-color': teamColor} as React.CSSProperties}>
                <header><h2>{teamNames[team.color_key] || team.name}</h2><Badge>{team.team_players?.length || 0} שחקנים</Badge></header>
                <div>{(team.team_players || []).map((player: any, index: number) => <span key={player.id}><i>{playerName(player)[0]}</i><strong>{playerName(player)}</strong>{player.guest && <small>אורח</small>}<b>{index + 1}</b></span>)}</div>
              </article>;
            })}
          </div>
          <div className="team-reveal-final-actions">
            <Button onClick={onShare}><Share2 size={17}/>שיתוף קישור לחשיפה</Button>
            <Button variant="secondary" onClick={start}><RefreshCcw size={17}/>צפייה שוב</Button>
            <Button variant="ghost" onClick={close}><Eye size={17}/>מעבר למסך המשחק</Button>
          </div>
        </section>}
      </main>
    </div>
  </div>, document.body);
}

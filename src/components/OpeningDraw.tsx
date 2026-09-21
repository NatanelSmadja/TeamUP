import {useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {Button} from './ui';
import {randomIndex, randomPair} from '../lib/openingDraw';

type DrawPhase = 'ready' | 'rolling' | 'result';

const teamNames: Record<string, string> = {
  red: 'האדומים',
  blue: 'הכחולים',
  yellow: 'הצהובים',
  green: 'הירוקים',
};

const teamColors: Record<string, string> = {
  red: '#ef5f6d',
  blue: '#5b8cff',
  yellow: '#f5c451',
  green: '#36d3ad',
};

const displayName = (team: any) => teamNames[team?.color_key] || team?.name || 'קבוצה';
const displayColor = (team: any) => teamColors[team?.color_key] || '#7047e8';
const displayInitial = (team: any) => {
  const name = displayName(team);
  return name.startsWith('ה') && name.length > 1 ? name.slice(1, 2) : name.slice(0, 1);
};

export default function OpeningDraw({teams, open, onClose}: {
  teams: any[];
  open: boolean;
  onClose: () => void;
}) {
  const orderedTeams = useMemo(() => teams.slice().sort((a, b) => Number(a.team_number || 0) - Number(b.team_number || 0)), [teams]);
  const [phase, setPhase] = useState<DrawPhase>('ready');
  const [shown, setShown] = useState<[number, number]>([0, Math.min(1, Math.max(orderedTeams.length - 1, 0))]);
  const [winners, setWinners] = useState<[number, number] | null>(null);
  const [lockedCount, setLockedCount] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);

  const clearAnimation = () => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  };

  useEffect(() => () => clearAnimation(), []);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
      clearAnimation();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPhase('ready');
    setWinners(null);
    setLockedCount(0);
    setShown([0, Math.min(1, Math.max(orderedTeams.length - 1, 0))]);
  }, [open, orderedTeams.length]);

  const animate = (finalPair: readonly [number, number]) => {
    if (orderedTeams.length < 2) return;
    clearAnimation();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setPhase('rolling');
    setWinners(null);
    setLockedCount(0);

    if (reduceMotion) {
      setShown([finalPair[0], finalPair[1]]);
      setWinners([finalPair[0], finalPair[1]]);
      setLockedCount(2);
      setPhase('result');
      return;
    }

    const startedAt = performance.now();
    let tick = 0;
    intervalRef.current = window.setInterval(() => {
      tick += 1;
      const elapsed = performance.now() - startedAt;
      if (elapsed < 1450) {
        const pair = randomPair(orderedTeams.length);
        setShown([pair[0], pair[1]]);
        return;
      }
      if (elapsed > 2550 && tick % 3 !== 0) return;
      setLockedCount(1);
      const alternatives = orderedTeams.map((_, index) => index).filter((index) => index !== finalPair[0]);
      setShown([finalPair[0], alternatives[randomIndex(alternatives.length)]]);
    }, 92);

    timeoutRef.current = window.setTimeout(() => {
      clearAnimation();
      setShown([finalPair[0], finalPair[1]]);
      setWinners([finalPair[0], finalPair[1]]);
      setLockedCount(2);
      setPhase('result');
      if ('vibrate' in navigator) navigator.vibrate([35, 45, 90]);
    }, 3300);
  };

  const roll = () => animate(randomPair(orderedTeams.length));

  const close = () => {
    clearAnimation();
    onCloseRef.current();
  };

  if (!open || orderedTeams.length < 2) return null;
  const visibleTeams = shown.map((index) => orderedTeams[index]);
  const waitingTeams = winners
    ? orderedTeams.filter((_, index) => !winners.includes(index))
    : [];

  return createPortal(
    <div className="opening-draw-layer" role="dialog" aria-modal="true" aria-labelledby="opening-draw-title">
      <div className="opening-draw-shell">
        <button className="opening-draw-close" onClick={close} aria-label="סגירה">×</button>
        <div className="opening-draw-brand">TEAMUP</div>

        <main className={`opening-draw-stage is-${phase}`}>
          <p className="opening-draw-kicker">הגרלת פתיחת המשחק</p>
          <h1 id="opening-draw-title">
            {phase === 'result' ? 'פותחים את המשחק' : phase === 'rolling' && lockedCount === 1 ? 'קבוצה אחת בפנים' : 'מי עולה ראשון?'}
          </h1>
          <p className="opening-draw-copy">
            {phase === 'ready' && `${orderedTeams.length} קבוצות. שתי קבוצות יעלו למגרש.`}
            {phase === 'rolling' && (lockedCount === 1 ? `${displayName(orderedTeams[shown[0]])} מחכים ליריבה...` : 'הקבוצות מתערבבות...')}
            {phase === 'result' && 'שתי הקבוצות הראשונות על המגרש'}</p>

          <div className="opening-draw-coins" aria-live="polite">
            {visibleTeams.map((team, index) => (
              <div className="opening-draw-slot" key={index}>
                <div
                  className={`opening-draw-coin ${phase === 'rolling' && lockedCount <= index ? 'is-spinning' : ''} ${lockedCount > index ? 'is-locked' : ''}`}
                  style={{'--draw-team': displayColor(team)} as CSSProperties}
                >
                  <div className="opening-draw-coin-face">
                    <span>{displayInitial(team)}</span>
                  </div>
                </div>
                <strong>{phase === 'ready' ? '???' : displayName(team)}</strong>
              </div>
            ))}
            <b className="opening-draw-vs">VS</b>
          </div>

          {phase === 'result' && waitingTeams.length > 0 && (
            <div className="opening-draw-waiting">
              <span>מחכות בצד</span>
              <strong>{waitingTeams.map(displayName).join(' · ')}</strong>
            </div>
          )}

          <div className="opening-draw-actions">
            {phase === 'ready' && <Button onClick={roll}>יאללה, מגרילים</Button>}
            {phase === 'rolling' && <Button disabled>מגרילים...</Button>}
            {phase === 'result' && <>
              <Button onClick={close}>עולים למגרש</Button>
              <button className="opening-draw-again" onClick={roll}>הגרלה חוזרת</button>
            </>}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}

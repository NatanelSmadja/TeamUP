import {useEffect, useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Share2, ShieldCheck, X} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from './ui';

type PlayerBannerData = {
  name: string;
  position: string;
  groupName: string;
  overall: number;
  rating: number;
  games: number;
  goals: number;
  mvp: number;
};

type Tier = {
  key: 'bronze' | 'silver' | 'gold' | 'special';
  name: string;
  c1: string;
  c2: string;
  accent: string;
  light: string;
  ink: string;
};

const tiers: Tier[] = [
  {key: 'bronze', name: 'BRONZE', c1: '#2b160d', c2: '#8f4f2d', accent: '#e69a65', light: '#ffd0ad', ink: '#fff3e8'},
  {key: 'silver', name: 'SILVER', c1: '#141b24', c2: '#6f8296', accent: '#d8e4ee', light: '#ffffff', ink: '#f4f9fc'},
  {key: 'gold', name: 'GOLD', c1: '#241a05', c2: '#9f6a05', accent: '#f8cd53', light: '#fff0a5', ink: '#fff9dc'},
  {key: 'special', name: 'SPECIAL', c1: '#160b3c', c2: '#156783', accent: '#4de8ff', light: '#d8fbff', ink: '#ffffff'},
];

function tierFor(overall: number) {
  if (overall >= 85) return tiers[3];
  if (overall >= 75) return tiers[2];
  if (overall >= 65) return tiers[1];
  return tiers[0];
}

function xml(value: string | number) {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[char] || char));
}

function stat(x: number, label: string, value: string | number, tier: Tier) {
  return `<g transform="translate(${x})"><rect width="119" height="108" rx="18" fill="#02060c" fill-opacity=".38" stroke="${tier.accent}" stroke-opacity=".28"/><text x="60" y="48" text-anchor="middle" fill="${tier.light}" font-family="Arial,sans-serif" font-size="30" font-weight="900">${xml(value)}</text><text x="60" y="77" text-anchor="middle" fill="${tier.accent}" font-family="Arial,sans-serif" font-size="14" font-weight="800">${xml(label)}</text></g>`;
}

function createBannerSvg(data: PlayerBannerData, tier: Tier) {
  const nameSize = data.name.length > 22 ? 39 : data.name.length > 16 ? 45 : 52;
  const special = tier.key === 'special'
    ? `<g opacity=".55">${Array.from({length: 18}, (_, i) => `<circle cx="${40 + (i * 83) % 1110}" cy="${45 + (i * 137) % 540}" r="${2 + i % 4}" fill="${i % 2 ? tier.accent : '#b66cff'}"/>`).join('')}</g><path d="M0 515L410 0h180L165 630z" fill="#8f4dff" opacity=".13"/><path d="M810 0L1200 385v130L680 0z" fill="#39e6ff" opacity=".11"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="1" x2="1" y2="0"><stop stop-color="${tier.c1}"/><stop offset="1" stop-color="${tier.c2}"/></linearGradient>
    <linearGradient id="jersey" x1="0" x2="1" y2="1"><stop stop-color="${tier.c2}"/><stop offset="1" stop-color="${tier.c1}"/></linearGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e9b28b"/><stop offset="1" stop-color="#a96545"/></linearGradient>
    <radialGradient id="glow"><stop stop-color="${tier.accent}" stop-opacity=".42"/><stop offset="1" stop-color="${tier.accent}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#fff" stroke-opacity=".035"/></pattern>
  </defs>
  <rect width="1200" height="630" rx="36" fill="url(#bg)"/><rect width="1200" height="630" rx="36" fill="url(#grid)"/><ellipse cx="305" cy="288" rx="350" ry="340" fill="url(#glow)"/>${special}
  <path d="M0 590L1200 428v202H0z" fill="#02060c" opacity=".36"/><path d="M585 0L475 630" stroke="${tier.accent}" stroke-width="3" opacity=".72"/>
  <g opacity=".98"><circle cx="292" cy="218" r="103" fill="url(#skin)"/><path d="M191 212c2-89 44-127 105-118 50 7 89 46 95 102-31-28-67-42-107-42-31 0-57 22-93 58z" fill="#101b2b"/><path d="M233 224q23-16 43 0M311 224q23-16 42 0" fill="none" stroke="#422d29" stroke-width="8" stroke-linecap="round"/><circle cx="258" cy="225" r="6" fill="#111827"/><circle cx="333" cy="225" r="6" fill="#111827"/><path d="M272 273q22 16 44 0" fill="none" stroke="#7f443e" stroke-width="7" stroke-linecap="round"/><path d="M122 588c10-174 72-252 170-252s161 78 173 252" fill="url(#jersey)"/><path d="M207 347l85 91 86-91-28 169-58 51-58-51z" fill="${tier.c1}" opacity=".82"/><path d="M156 445h272" stroke="${tier.accent}" stroke-width="7" opacity=".7"/><text x="292" y="493" text-anchor="middle" fill="${tier.ink}" font-family="Arial,sans-serif" font-size="32" font-weight="900">TEAMUP</text></g>
  <g font-family="Arial,sans-serif"><g transform="translate(1090 53)"><path d="M0 0h74v88l-37 27L0 88z" fill="#07101f" fill-opacity=".72" stroke="${tier.accent}" stroke-width="3"/><text x="37" y="49" text-anchor="middle" fill="${tier.light}" font-size="25" font-weight="900">TU</text><text x="37" y="75" text-anchor="middle" fill="${tier.accent}" font-size="10" font-weight="700">CLUB</text></g>
  <text x="1035" y="88" text-anchor="end" fill="${tier.accent}" font-size="22" font-weight="900" letter-spacing="4">${tier.name}</text><text x="1038" y="184" text-anchor="end" fill="${tier.light}" font-size="94" font-weight="1000">${data.overall}</text><text x="1041" y="214" text-anchor="end" fill="${tier.accent}" font-size="18" font-weight="900" letter-spacing="3">OVERALL</text>
  <text x="1110" y="302" text-anchor="end" fill="${tier.ink}" font-size="${nameSize}" font-weight="900">${xml(data.name)}</text><text x="1110" y="342" text-anchor="end" fill="${tier.accent}" font-size="21" font-weight="800">${xml(data.position)} · ${xml(data.groupName)}</text><path d="M615 379H1110" stroke="${tier.accent}" stroke-opacity=".55"/>
  <g transform="translate(605 405)">${stat(0, 'משחקים', data.games, tier)}${stat(132, 'שערים', data.goals, tier)}${stat(264, 'MVP', data.mvp, tier)}${stat(396, 'דירוג', data.rating.toFixed(2), tier)}</g>
  <text x="1110" y="584" text-anchor="end" fill="${tier.ink}" fill-opacity=".7" font-size="14" font-weight="700" letter-spacing="2">THE PLAYER COLLECTION · ${new Date().getFullYear()}</text><text x="605" y="584" fill="${tier.accent}" font-size="14" font-weight="900" letter-spacing="2">TEAMUP</text></g>
  <rect x="2" y="2" width="1196" height="626" rx="34" fill="none" stroke="${tier.accent}" stroke-width="4" stroke-opacity=".8"/>
</svg>`;
}

function svgUrl(svg: string) {
  return URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml;charset=utf-8'}));
}

async function pngBlob(svg: string) {
  const source = svgUrl(svg);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const next = new Image();
      next.onload = () => resolve(next);
      next.onerror = () => reject(new Error('לא הצלחנו לטעון את הבאנר'));
      next.src = source;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('לא הצלחנו ליצור את התמונה')), 'image/png', 1));
  } finally {
    URL.revokeObjectURL(source);
  }
}

function safeFileName(name: string) {
  return name.trim().replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '') || 'player';
}

export function PlayerBannerDialog({open, onClose, data}: {open: boolean; onClose: () => void; data: PlayerBannerData}) {
  const [busy, setBusy] = useState(false);
  const tier = tierFor(data.overall);
  const svg = useMemo(() => createBannerSvg(data, tier), [data, tier]);
  const previewUrl = useMemo(() => svgUrl(svg), [svg]);
  const fileName = `teamup-${safeFileName(data.name)}-${tier.key}.png`;

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, onClose]);

  const download = async () => {
    setBusy(true);
    try {
      const blob = await pngBlob(svg);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('הבאנר נשמר כתמונה');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'לא הצלחנו לייצא את הבאנר');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    setBusy(true);
    try {
      const blob = await pngBlob(svg);
      const file = new File([blob], fileName, {type: 'image/png'});
      if (navigator.share && (!navigator.canShare || navigator.canShare({files: [file]}))) {
        await navigator.share({title: `${data.name} · TEAMUP`, text: `כרטיס השחקן של ${data.name}`, files: [file]});
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success('התמונה הורדה — אפשר לשלוח אותה בוואטסאפ');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast.error(error instanceof Error ? error.message : 'לא הצלחנו לשתף את הבאנר');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return createPortal(<div className="player-banner-layer" role="dialog" aria-modal="true" aria-labelledby="player-banner-title" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className={`player-banner-dialog player-banner-dialog--${tier.key}`}>
      <div className="player-banner-head"><div><span>{tier.name} · OVR {data.overall}</span><h2 id="player-banner-title">הבאנר של {data.name}</h2><p>נוצר אוטומטית מהנתונים המאומתים של השחקן.</p></div><Button variant="ghost" aria-label="סגירת הבאנר" onClick={onClose}><X size={20}/></Button></div>
      <div className="player-banner-preview"><img src={previewUrl} alt={`באנר השחקן של ${data.name}`}/></div>
      <div className="player-banner-trust"><ShieldCheck size={18}/><div><strong>הנתונים נעולים</strong><span>הדירוג, המשחקים, השערים וה־MVP נלקחו ישירות מ־TEAMUP ולא ניתנים לעריכה כאן.</span></div></div>
      <div className="player-banner-actions"><Button disabled={busy} onClick={share}><Share2 size={18}/>{busy ? 'מכין תמונה...' : 'שיתוף הבאנר'}</Button><Button variant="secondary" disabled={busy} onClick={download}><Download size={18}/>הורדת PNG</Button></div>
    </div>
  </div>, document.body);
}

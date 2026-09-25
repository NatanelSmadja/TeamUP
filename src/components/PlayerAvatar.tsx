import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {avatarUrl} from '../lib/avatarUrl';

export default function PlayerAvatar({profile, name, className = 'player-avatar'}: {
  profile?: {avatar_url?: string | null; first_name?: string | null} | null;
  name?: string; className?: string;
}) {
  const src = avatarUrl(profile?.avatar_url);
  const [failed, setFailed] = useState<string>();
  const [opened, setOpened] = useState<string>();
  const hasImage = !!src && failed !== src;
  const label = (name || profile?.first_name || 'השחקן').trim();
  return <><span className={`${className} avatar-frame${hasImage ? ' avatar-clickable' : ''}`}
    role={hasImage ? 'button' : undefined} tabIndex={hasImage ? 0 : undefined}
    aria-hidden={hasImage ? undefined : true} aria-label={hasImage ? `פתיחת התמונה של ${label}` : undefined}
    aria-haspopup={hasImage ? 'dialog' : undefined}
    onClick={hasImage ? event => {event.preventDefault(); event.stopPropagation(); setOpened(src);} : undefined}
    onKeyDown={hasImage ? event => {
      event.stopPropagation();
      if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); setOpened(src);}
    } : undefined}>
    {hasImage ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)}/> : (name || profile?.first_name || 'ש').trim()[0] || 'ש'}
  </span>{hasImage && opened === src && <AvatarLightbox src={src} label={label} onClose={() => setOpened(undefined)} onError={() => {setFailed(src); setOpened(undefined);}}/>}</>;
}

function AvatarLightbox({src, label, onClose, onError}: {src: string; label: string; onClose: () => void; onError: () => void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {element.close(); document.body.style.overflow = overflow;};
  }, []);
  return createPortal(<dialog ref={dialog} className="avatar-lightbox" aria-label={`התמונה של ${label}`}
    onCancel={event => {event.preventDefault(); onClose();}}
    onClick={event => {event.stopPropagation(); if (event.target === event.currentTarget) onClose();}}
    onKeyDown={event => event.stopPropagation()}>
    <div className="avatar-lightbox-content" dir="rtl">
      <button type="button" className="avatar-lightbox-close" aria-label="סגירת התמונה" onClick={onClose} autoFocus><X size={24}/></button>
      <img src={src} alt={`התמונה של ${label}`} onError={onError}/>
      <p>{label}</p>
    </div>
  </dialog>, document.body);
}

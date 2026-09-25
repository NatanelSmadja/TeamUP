import {useState} from 'react';
import {avatarUrl} from '../lib/avatarUrl';

export default function PlayerAvatar({profile, name, className = 'player-avatar'}: {
  profile?: {avatar_url?: string | null; first_name?: string | null} | null;
  name?: string; className?: string;
}) {
  const src = avatarUrl(profile?.avatar_url);
  const [failed, setFailed] = useState<string>();
  return <span className={`${className} avatar-frame`} aria-hidden="true">
    {src && failed !== src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)}/> : (name || profile?.first_name || 'ש').trim()[0] || 'ש'}
  </span>;
}

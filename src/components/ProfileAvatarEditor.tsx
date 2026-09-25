import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {toast} from 'sonner';
import type {Profile} from '../types';
import {supabase} from '../lib/supabase';
import {compressAvatar, MAX_AVATAR_BYTES} from '../lib/avatarCompression';
import PlayerAvatar from './PlayerAvatar';
import {Button} from './ui';

export default function ProfileAvatarEditor({profile,onSaved}: {profile: Profile; onSaved: () => Promise<void>}) {
  const [draft,setDraft] = useState<{blob: Blob; url: string} | null>(null);
  const [busy,setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const queryClient = useQueryClient();
  useEffect(() => () => {sequence.current++;}, []);
  useEffect(() => () => {if (draft) URL.revokeObjectURL(draft.url);}, [draft]);
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const current = ++sequence.current;
    setBusy(true);
    try {
      const blob = await compressAvatar(file);
      if (current === sequence.current) setDraft({blob,url: URL.createObjectURL(blob)});
    } catch(error: any) {toast.error(error.message || 'לא הצלחנו לעבד את התמונה');}
    finally {if (current === sequence.current) setBusy(false);}
  };
  const refresh = async () => {await onSaved(); await queryClient.invalidateQueries();};
  const save = async () => {
    if (!draft || busy || draft.blob.size > MAX_AVATAR_BYTES) return;
    setBusy(true);
    try {
      const {error: uploadError} = await supabase.storage.from('profile-avatars').upload(`${profile.id}/avatar`,draft.blob,{upsert:true,contentType:draft.blob.type,cacheControl:'3600'});
      if (uploadError) throw uploadError;
      const {error} = await supabase.rpc('set_own_profile_avatar',{p_version:crypto.randomUUID()});
      if (error) throw error;
      setDraft(null); await refresh(); toast.success('תמונת הפרופיל נשמרה');
    } catch(error: any) {toast.error(error.message || 'לא הצלחנו לשמור את התמונה');}
    finally {setBusy(false);}
  };
  const remove = async () => {
    if (busy || !confirm('להסיר את תמונת הפרופיל?')) return;
    setBusy(true);
    try {
      const {error} = await supabase.rpc('set_own_profile_avatar',{p_version:null});
      if (error) throw error;
      const {error: removeError} = await supabase.storage.from('profile-avatars').remove([`${profile.id}/avatar`]);
      setDraft(null); await refresh();
      if (removeError) toast.error('התמונה הוסרה מהפרופיל, אך ניקוי הקובץ נכשל. העלאת תמונה חדשה תחליף אותו.');
      else toast.success('התמונה הוסרה');
    } catch(error: any) {toast.error(error.message || 'לא הצלחנו להסיר את התמונה');}
    finally {setBusy(false);}
  };
  return <section className="profile-avatar-editor" aria-label="תמונת פרופיל" aria-busy={busy}>
    {draft ? <img className="profile-avatar-preview" src={draft.url} alt="תצוגה מקדימה של תמונת הפרופיל"/> : <PlayerAvatar profile={profile} className="profile-avatar-preview"/>}
    <div><h3>תמונת פרופיל</h3><p>התמונה תופיע במקום האות לצד השם שלך.</p><p>JPG, PNG או WebP עד 10MB. אנחנו מקטינים לפני ההעלאה, עד 50KB בלבד.</p>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="בחירת תמונת פרופיל" onChange={choose} disabled={busy} hidden/>
      <div className="profile-avatar-actions">
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'מעבד...' : 'בחירת תמונה'}</Button>
        {draft && <><Button onClick={save} disabled={busy}>שמירת התמונה</Button><Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>ביטול</Button></>}
        {profile.avatar_url && !draft && <Button variant="ghost" onClick={remove} disabled={busy}>הסרת תמונה</Button>}
      </div>
      {draft && <small>תצוגה מקדימה · {Math.ceil(draft.blob.size/1024)}KB לאחר הקטנה. התמונה עדיין לא נשמרה.</small>}
    </div>
  </section>;
}

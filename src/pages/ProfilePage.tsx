import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {Badge, Button, Card, Input, Select, FieldHelp} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {useGroup} from '../hooks/useGroup';
import {supabase} from '../lib/supabase';
import {Bell, ChevronLeft, Download, RefreshCw} from 'lucide-react';
import {currentPushState, disablePushNotifications, enablePushNotifications, type PushState} from '../lib/pushNotifications';
import ProfileAvatarEditor from '../components/ProfileAvatarEditor';

const positions = [
  ['goalkeeper', 'שוער'],
  ['defender', 'מגן'],
  ['midfielder', 'קשר'],
  ['winger', 'כנף'],
  ['striker', 'חלוץ'],
  ['utility', 'כללי'],
] as const;

const positionName = (value?: string) => positions.find(([key]) => key === value)?.[1] || 'שחקן';
const footName = (value?: string) => value === 'left' ? 'רגל שמאל' : value === 'both' ? 'שתי הרגליים' : 'רגל ימין';
type InstallPromptEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};

export default function ProfilePage() {
  const {profile, signOut, refreshProfile} = useAuth();
  const {data: groupSession} = useGroup();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [pushState, setPushState] = useState<PushState>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({first_name: '', last_name: '', birth_date: '', preferred_positions: ['utility'] as string[], preferred_foot: 'right'});

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  useEffect(() => {
    void currentPushState().then(setPushState).catch(() => setPushState('disabled'));
  }, []);

  const savedValues = useMemo(() => profile ? JSON.stringify({
    first_name: profile.first_name || '',
    last_name: profile.last_name || '',
    birth_date: profile.birth_date || '',
    preferred_positions: (profile as any).preferred_positions?.length ? (profile as any).preferred_positions : [profile.preferred_position || 'utility'],
    preferred_foot: profile.preferred_foot || 'right',
  }) : '', [profile]);
  // Updating only the photo must not discard unsaved edits to personal details.
  useEffect(() => {if (savedValues) setF(JSON.parse(savedValues));}, [savedValues]);
  const dirty = !!profile && JSON.stringify(f) !== savedValues;
  const displayName = [f.first_name.trim(), f.last_name.trim()].filter(Boolean).join(' ') || 'השם שלך';
  const shirtName = f.first_name.trim() || 'שחקן';
  const groupName = groupSession?.group.name || 'הקבוצה שלי';
  const mainPosition = positionName(f.preferred_positions[0]);
  const completeness = [f.first_name.trim(), f.last_name.trim(), f.birth_date, f.preferred_positions.length, f.preferred_foot].filter(Boolean).length * 20;
  const themeColor = groupSession?.group.theme_color || '#7047e8';

  const toggle = (position: string) => setF((current) => ({
    ...current,
    preferred_positions: current.preferred_positions.includes(position)
      ? current.preferred_positions.filter((value) => value !== position)
      : [...current.preferred_positions, position],
  }));

  const save = async () => {
    if (!f.first_name.trim() || !f.last_name.trim()) return toast.error('יש להזין שם פרטי ושם משפחה');
    if (!f.preferred_positions.length) return toast.error('בחר לפחות עמדה אחת');
    setSaving(true);
    const {error} = await supabase.rpc('update_own_profile', {
      p_first_name: f.first_name.trim(),
      p_last_name: f.last_name.trim(),
      p_birth_date: f.birth_date || null,
      p_preferred_positions: f.preferred_positions,
      p_preferred_foot: f.preferred_foot,
    });
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }
    await refreshProfile();
    setSaving(false);
    toast.success('הפרופיל נשמר');
  };

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } else toast('באייפון: לחץ שיתוף ואז ״הוסף למסך הבית״');
  };

  const update = async () => {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
    if (registration?.waiting) registration.waiting.postMessage({type: 'SKIP_WAITING'});
    toast.success('בדקנו עדכון');
  };

  const notifications = async () => {
    setPushBusy(true);
    try {
      if (pushState === 'enabled') {
        await disablePushNotifications();
        setPushState('disabled');
        toast.success('ההתראות כובו במכשיר הזה');
      } else {
        await enablePushNotifications();
        setPushState('enabled');
        toast.success('ההתראות הופעלו במכשיר הזה');
      }
    } catch (error: any) {
      setPushState(await currentPushState().catch(() => 'disabled' as PushState));
      toast.error(error?.message || 'לא הצלחנו לעדכן את ההתראות');
    } finally {
      setPushBusy(false);
    }
  };

  const pushLabel = pushState === 'enabled'
    ? 'פעילות במכשיר הזה'
    : pushState === 'denied'
      ? 'חסומות בהגדרות המכשיר'
      : pushState === 'needs-install'
        ? 'דורש הוספה למסך הבית באייפון'
        : pushState === 'unsupported'
          ? 'לא נתמך במכשיר הזה'
          : pushState === 'checking'
            ? 'בודק תמיכה...'
            : 'כבויות במכשיר הזה';

  return (
    <div className="profile-page profile-page-v2 space-y-5" style={{'--player-color': themeColor} as CSSProperties}>
      <section className="profile-identity-hero">
        <div className="profile-jersey-stage" aria-hidden="true">
          <div className="profile-jersey">
            <span>{groupName}</span>
            <strong>{shirtName}</strong>
            <small>{mainPosition}</small>
          </div>
        </div>
        <div className="profile-identity-copy">
          <span className="profile-eyebrow">הפרופיל שלי</span>
          <h1>{displayName}</h1>
          <p>{groupName}</p>
          <div className="profile-identity-tags">
            {f.preferred_positions.map((position) => <span key={position}>{positionName(position)}</span>)}
            <span>{footName(f.preferred_foot)}</span>
          </div>
          {profile && <Link to={`/players/${profile.id}`} className="profile-card-link">לכרטיס השחקן המלא <ChevronLeft size={18}/></Link>}
        </div>
        <div className="profile-completeness">
          <div><span>הפרופיל שלך</span><strong>{completeness}%</strong></div>
          <i><b style={{width: `${completeness}%`}} /></i>
          <small>{completeness === 100 ? 'הכול מוכן למשחק' : 'השלם את הפרטים כדי שהקבוצה תכיר אותך'}</small>
        </div>
      </section>

      <div className="profile-workspace">
        <Card className="form-card profile-form-card profile-editor-card">
          {profile && <ProfileAvatarEditor key={profile.id} profile={profile} onSaved={refreshProfile}/>}
          <header className="profile-section-heading">
            <div><span>01</span><h2>פרטים אישיים</h2></div>
            <p>המידע שמופיע בהרשמות, בחלוקת קבוצות ובדירוגים.</p>
          </header>
          <div className="form-grid">
            <div>
              <FieldHelp title="שם פרטי">השם שיופיע ברחבי הקבוצה.</FieldHelp>
              <Input value={f.first_name} onChange={(e) => setF({...f, first_name: e.target.value})} autoComplete="given-name" />
            </div>
            <div>
              <FieldHelp title="שם משפחה">עוזר לזהות שחקנים בעלי שם דומה.</FieldHelp>
              <Input value={f.last_name} onChange={(e) => setF({...f, last_name: e.target.value})} autoComplete="family-name" />
            </div>
          </div>
          <div className="profile-birth-field">
            <FieldHelp title="תאריך לידה">משמש להצגת גיל נכון בכרטיס השחקן.</FieldHelp>
            <Input type="date" value={f.birth_date} onChange={(e) => setF({...f, birth_date: e.target.value})} />
          </div>

          <div className="profile-field-divider" />
          <header className="profile-section-heading compact">
            <div><span>02</span><h2>סגנון משחק</h2></div>
            <p>העמדה הראשונה שתבחר תופיע כעמדה הראשית שלך.</p>
          </header>
          <div className="choice-grid profile-position-grid">
            {positions.map(([value, label]) => (
              <button
                title={`בחירת ${label}`}
                type="button"
                className={`${f.preferred_positions.includes(value) ? 'active' : ''}${f.preferred_positions[0] === value ? ' primary' : ''}`}
                onClick={() => toggle(value)}
                key={value}
                aria-pressed={f.preferred_positions.includes(value)}
              >
                <span>{label}</span>
                <small>{f.preferred_positions[0] === value ? 'עמדה ראשית' : f.preferred_positions.includes(value) ? 'נבחרה' : 'בחירה'}</small>
              </button>
            ))}
          </div>
          <div className="profile-foot-field">
            <FieldHelp title="רגל מועדפת">באיזו רגל נוח לך יותר לשחק?</FieldHelp>
            <Select value={f.preferred_foot} onChange={(e) => setF({...f, preferred_foot: e.target.value})}>
              <option value="right">ימין</option>
              <option value="left">שמאל</option>
              <option value="both">שתיהן</option>
            </Select>
          </div>
          <div className="profile-save-row">
            <span>{dirty ? 'יש שינויים שעדיין לא נשמרו' : 'הפרטים מעודכנים'}</span>
            <Button onClick={save} disabled={!dirty || saving}>{saving ? 'שומר...' : 'שמירת שינויים'}</Button>
          </div>
        </Card>

        <Card className="profile-app-card">
          <header className="profile-section-heading">
            <div><span>03</span><h2>האפליקציה במכשיר</h2></div>
            <Badge>{pushLabel}</Badge>
          </header>
          <p className="section-help">בחר אילו שירותים להפעיל במכשיר הנוכחי.</p>
          <div className="settings-actions">
            <Button variant="secondary" onClick={install} title="התקנת TEAMUP במסך הבית"><Download size={18}/>הוספה למסך הבית</Button>
            <Button variant="secondary" onClick={update} title="בדיקה אם פורסמה גרסה חדשה"><RefreshCw size={18}/>בדיקת עדכון</Button>
            <Button
              variant={pushState === 'enabled' ? 'danger' : 'secondary'}
              disabled={pushBusy || pushState === 'checking' || pushState === 'unsupported' || pushState === 'denied'}
              onClick={notifications}
              title={pushState === 'enabled' ? 'כיבוי התראות במכשיר הזה' : 'אישור התראות משחק וסקר במכשיר'}
            >
              <Bell size={18}/>{pushBusy ? 'מעדכן...' : pushState === 'enabled' ? 'כיבוי התראות' : 'הפעלת התראות'}
            </Button>
          </div>
        </Card>
      </div>

      <button type="button" className="profile-signout-link" onClick={signOut}>יציאה מהחשבון במכשיר הזה</button>
    </div>
  );
}

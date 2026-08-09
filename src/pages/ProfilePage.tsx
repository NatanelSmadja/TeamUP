import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from 'sonner';
import {Badge, Button, Card, Input, Select, FieldHelp} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {supabase} from '../lib/supabase';
import {Bell, ChevronLeft, Download, RefreshCw, Trophy} from 'lucide-react';
import {currentPushState, disablePushNotifications, enablePushNotifications, type PushState} from '../lib/pushNotifications';
const positions = [
  ['goalkeeper', 'שוער'],
  ['defender', 'מגן'],
  ['midfielder', 'קשר'],
  ['winger', 'כנף'],
  ['striker', 'חלוץ'],
  ['utility', 'כללי'],
];
type InstallPromptEvent = Event & {prompt: () => Promise<void>; userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>};
export default function ProfilePage() {
  const {profile, signOut, refreshProfile} = useAuth();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [pushState, setPushState] = useState<PushState>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  const initial = (profile as any)?.preferred_positions || [profile?.preferred_position || 'utility'];
  const [f, setF] = useState({
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    birth_date: profile?.birth_date || '',
    preferred_positions: initial as string[],
    preferred_foot: profile?.preferred_foot || 'right',
  });
  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  useEffect(() => {
    void currentPushState()
      .then(setPushState)
      .catch(() => setPushState('disabled'));
  }, []);
  const toggle = (p: string) =>
    setF((x) => ({
      ...x,
      preferred_positions: x.preferred_positions.includes(p) ? x.preferred_positions.filter((v) => v !== p) : [...x.preferred_positions, p],
    }));
  const save = async () => {
    if (!f.preferred_positions.length) return toast.error('בחר לפחות עמדה אחת');
    const {error} = await supabase
      .from('profiles')
      .update({...f, preferred_position: f.preferred_positions[0]})
      .eq('id', profile!.id);
    if (error) return toast.error(error.message);
    await refreshProfile();
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
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    if (reg?.waiting) reg.waiting.postMessage({type: 'SKIP_WAITING'});
    toast.success('בדקנו עדכון');
  };
  const notifications = async () => {
    setPushBusy(true);
    try {
      if (pushState === 'enabled') {
        await disablePushNotifications();
        setPushState('disabled');
        toast.success('התראות ה־Push כובו במכשיר הזה');
      } else {
        await enablePushNotifications();
        setPushState('enabled');
        toast.success('התראות ה־Push הופעלו במכשיר הזה');
      }
    } catch (error: any) {
      setPushState(await currentPushState().catch(() => 'disabled' as PushState));
      toast.error(error?.message || 'לא הצלחנו לעדכן את ההתראות');
    } finally {
      setPushBusy(false);
    }
  };
  const pushLabel =
    pushState === 'enabled'
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
    <div className="space-y-5">
      <div className="page-heading">
        <div>
          <p>הפרטים שלך ב־TEAMUP</p>
          <h1>הפרופיל שלי</h1>
        </div>
      </div>
      {profile && (
        <Link to={`/players/${profile.id}`} className="my-player-card-link">
          <Card>
            <div className="my-player-card-icon">
              <Trophy />
            </div>
            <div>
              <small>TEAMUP PLAYER</small>
              <h2>כרטיס השחקן שלי</h2>
              <p>צפה בנתונים, בהישגים ובשערים שלך ושתף את הכרטיס.</p>
            </div>
            <ChevronLeft />
          </Card>
        </Link>
      )}
      <Card className="form-card">
        <div className="form-grid">
          <div>
            <FieldHelp title="שם פרטי">השם שיופיע בסקרים ובהרשמות.</FieldHelp>
            <Input value={f.first_name} onChange={(e) => setF({...f, first_name: e.target.value})} />
          </div>
          <div>
            <FieldHelp title="שם משפחה">עוזר לזהות שחקנים בעלי שם דומה.</FieldHelp>
            <Input value={f.last_name} onChange={(e) => setF({...f, last_name: e.target.value})} />
          </div>
        </div>
        <FieldHelp title="עמדות מועדפות">אפשר לבחור כמה עמדות. הראשונה תשמש כעמדה הראשית.</FieldHelp>
        <div className="choice-grid">
          {positions.map(([v, l]) => (
            <button
              title={`בחירת ${l}`}
              type="button"
              className={f.preferred_positions.includes(v) ? 'active' : ''}
              onClick={() => toggle(v)}
              key={v}
            >
              {l}
            </button>
          ))}
        </div>
        <FieldHelp title="רגל מועדפת">באיזו רגל נוח לך יותר לשחק?</FieldHelp>
        <Select value={f.preferred_foot} onChange={(e) => setF({...f, preferred_foot: e.target.value as any})}>
          <option value="right">ימין</option>
          <option value="left">שמאל</option>
          <option value="both">שתיהן</option>
        </Select>
        <Button className="w-full" onClick={save}>
          שמירת שינויים
        </Button>
      </Card>
      <Card>
        <div className="section-title">
          <div>
            <h2 className="font-black">האפליקציה וההתראות</h2>
            <p className="section-help">Push הוא אישור חינמי במכשיר בלבד — אין כאן מנוי או תשלום.</p>
          </div>
          <Badge>{pushLabel}</Badge>
        </div>
        <div className="settings-actions">
          <Button variant="secondary" onClick={install} title="התקנת TEAMUP במסך הבית">
            <Download size={18} />
            הוספה למסך הבית
          </Button>
          <Button variant="secondary" onClick={update} title="בדיקה אם פורסמה גרסה חדשה">
            <RefreshCw size={18} />
            עדכון האפליקציה
          </Button>
          <Button
            variant={pushState === 'enabled' ? 'danger' : 'secondary'}
            disabled={pushBusy || pushState === 'checking' || pushState === 'unsupported' || pushState === 'denied'}
            onClick={notifications}
            title={pushState === 'enabled' ? 'כיבוי Push במכשיר הזה' : 'אישור התראות משחק וסקר במכשיר'}
          >
            <Bell size={18} />
            {pushBusy ? 'מעדכן...' : pushState === 'enabled' ? 'כיבוי התראות' : 'הפעלת התראות'}
          </Button>
        </div>
      </Card>
      <Button variant="danger" className="w-full" title="התנתקות מהחשבון במכשיר זה" onClick={signOut}>
        יציאה מהחשבון
      </Button>
    </div>
  );
}

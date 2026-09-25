import {useQuery} from '@tanstack/react-query';
import {RefreshCw} from 'lucide-react';
import {supabase} from '../lib/supabase';
import {Button, Card} from './ui';
import {formatBytes, usageLevel} from '../lib/resourceUsage';

type BucketUsage = {id: string; file_count: number; bytes: number; unknown_size_count: number};
export type ResourceUsage = {measured_at: string; database_bytes: number; buckets: BucketUsage[]};

function UsageMeter({title, bytes, limit, incomplete = false, children}: {
  title: string; bytes: number; limit: number; incomplete?: boolean; children: React.ReactNode;
}) {
  const level = usageLevel(bytes, limit);
  const percent = bytes / limit * 100;
  return <section className={`resource-usage-meter resource-usage-${incomplete ? 'unknown' : level}`}>
    <h3>{title}</h3>
    <strong>{incomplete ? 'לפחות ' : ''}<bdi>{formatBytes(bytes)}</bdi> מתוך <bdi>{formatBytes(limit)}</bdi></strong>
    <progress aria-label={title} value={Math.min(bytes, limit)} max={limit}/>
    <p>{incomplete ? 'המדידה חלקית — לא ניתן לחשב יתרה' : <>
      {percent.toLocaleString('he-IL', {maximumFractionDigits: 1})}% בשימוש · {bytes >= limit
        ? `המכסה להשוואה ${bytes > limit ? 'נחצתה' : 'מוצתה'}`
        : <>נותרו להשוואה <bdi>{formatBytes(limit - bytes)}</bdi></>}
    </>}</p>
    {!incomplete && <b>{level === 'danger' ? 'קרוב למכסה או מעליה — יש לבדוק אצל הספק' : level === 'warning' ? 'מעל 80% מהמכסה להשוואה' : 'מתחת ל־80% מהמכסה להשוואה'}</b>}
    <small>{children}</small>
  </section>;
}

export function ResourceUsageDetails({data}: {data: ResourceUsage}) {
  const total = data.buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const unknown = data.buckets.reduce((sum, bucket) => sum + bucket.unknown_size_count, 0);
  const avatars = data.buckets.find(bucket => bucket.id === 'profile-avatars');
  return <>
    <p>נמדד ב־{new Date(data.measured_at).toLocaleString('he-IL')}. המדידה מתעדכנת בפתיחת המסך וברענון.</p>
    <div className="resource-usage-grid">
      <UsageMeter title="Supabase · מסד הנתונים" bytes={data.database_bytes} limit={500_000_000}>
        נפח מסדי הנתונים בפרויקט, כולל אינדקסים ונתוני מערכת. לא כולל WAL ולוגים.
      </UsageMeter>
      <UsageMeter title="Supabase · אחסון קבצים" bytes={total} limit={1_000_000_000} incomplete={unknown > 0}>
        כל הקבצים בפרויקט. המכסה משותפת לארגון; שימוש בפרויקטים אחרים אינו נכלל כאן.
      </UsageMeter>
    </div>
    <p>תמונות פרופיל: {(avatars?.file_count ?? 0).toLocaleString('he-IL')} קבצים · {avatars?.unknown_size_count ? 'לפחות ' : ''}<bdi>{formatBytes(avatars?.bytes ?? 0)}</bdi>. עד 50KB לתמונה שמורה.</p>
    {unknown > 0 && <p role="alert">ל־{unknown} קבצים חסר גודל תקין. יש לבדוק את נפח האחסון המלא ב־Supabase.</p>}
  </>;
}

export default function SystemResourceUsage() {
  const usage = useQuery({
    queryKey: ['system-resource-usage'],
    queryFn: async () => {
      const {data, error} = await supabase.rpc('system_admin_resource_usage');
      if (error) throw error;
      return data as ResourceUsage;
    },
    staleTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
  return <Card className="resource-usage" dir="rtl">
    <div className="resource-usage-heading">
      <div><h2>שימוש במשאבים ומכסות</h2><p>למנהל המערכת בלבד</p></div>
      <Button variant="secondary" disabled={usage.isFetching} onClick={() => void usage.refetch()}><RefreshCw size={16}/>{usage.isFetching ? 'בודק...' : 'רענון נתונים'}</Button>
    </div>
    <p className="resource-usage-notice">בדיקה חלקית בלבד: אין כאן אישור שלא חרגת מכל המכסות. תעבורה, שימוש חודשי ושימוש ב־Vercel מחייבים בדיקה בלוחות הספקים.</p>
    <p>ההשוואה היא למסלול Supabase Free: מסד נתונים 500MB ואחסון 1GB. המסלול בפועל אינו מזוהה אוטומטית; הנתונים אינם חשבון חיוב או יתרה ארגונית מאומתת. <a href="https://supabase.com/pricing" target="_blank" rel="noopener noreferrer">מכסות המסלול</a></p>
    {usage.isLoading && <p role="status">טוען נתוני שימוש...</p>}
    {usage.isError && <p role="alert">לא ניתן לעדכן את נתוני השימוש. אם זה העדכון הראשון, יש להריץ את SQL מספר 056 ב־Supabase. אחרת נסה לרענן או בדוק בלוח הספק. {usage.data && 'הנתונים המוצגים הם מהבדיקה הקודמת.'}</p>}
    {usage.data && <ResourceUsageDetails data={usage.data}/>}
    <div className="resource-usage-grid">
      <section className="resource-usage-meter resource-usage-unknown"><h3>Supabase · מכסות שלא נמדדות כאן</h3><b>טרם נבדקו</b><p>תעבורה רגילה ומטמון, משתמשים פעילים בחודש, Realtime, פונקציות, ושימוש בפרויקטים נוספים. הנתונים אצל הספק עשויים להיות ממוצעים לתקופת החיוב.</p><a href="https://supabase.com/dashboard/org/_/usage" target="_blank" rel="noopener noreferrer">פתיחת Usage ב־Supabase ↗</a></section>
      <section className="resource-usage-meter resource-usage-unknown"><h3>Vercel · שימוש בחשבון</h3><b>לא מחובר למדידה — טרם נבדק</b><p>יש לבדוק תעבורה, בקשות, פונקציות, עיבוד תמונות, בניות ואחסון פריסות. בלוח Vercel בחר את הצוות ואז Usage. תמונות הפרופיל עצמן נשמרות ב־Supabase.</p><a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">פתיחת Vercel לבדיקת Usage ↗</a></section>
    </div>
    <small>ההתראות מופיעות כאן בזמן בדיקה: מ־80% התראה ומ־95% התראה מוגברת. אין ניטור ברקע או חסימה אוטומטית.</small>
  </Card>;
}

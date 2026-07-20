import {useState} from 'react';
import {supabase, isSupabaseConfigured} from '../lib/supabase';
import {Button, Card, Input, Select} from '../components/ui';
import {toast} from 'sonner';
import {Goal, Mail, LockKeyhole} from 'lucide-react';

export default function AuthPage() {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [busy, setBusy] = useState(false);
    const [f, setF] = useState({
        email: '',
        password: '',
        first_name: '',
        last_name: '',
        birth_date: '',
        preferred_position: 'midfielder',
        preferred_foot: 'right'
    });
    const set = (k: string, v: string) => setF(x => ({...x, [k]: v}));
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isSupabaseConfigured) return toast.error('יש להגדיר קובץ .env.local');
        setBusy(true);
        try {
            if (mode === 'login') {
                const {error} = await supabase.auth.signInWithPassword({email: f.email, password: f.password});
                if (error) throw error
            } else {
                const {error} = await supabase.auth.signUp({
                    email: f.email,
                    password: f.password,
                    options: {
                        data: {
                            first_name: f.first_name,
                            last_name: f.last_name,
                            birth_date: f.birth_date,
                            preferred_position: f.preferred_position,
                            preferred_positions: [f.preferred_position],
                            preferred_foot: f.preferred_foot
                        }
                    }
                });
                if (error) throw error;
                toast.success('נרשמת בהצלחה. אם אימות מייל פעיל, בדוק את המייל.')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'אירעה שגיאה')
        } finally {
            setBusy(false)
        }
    };
    return <div className="mx-auto flex min-h-screen max-w-md items-center p-4"><Card className="w-full p-6">
        <div className="mb-6 text-center">
            <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-3xl bg-[#6fae87] text-[#07100b]">
                <Goal size={34}/></div>
            <h1 className="text-3xl font-black">TEAMUP</h1><p className="mt-2 text-sm text-[#8fa097]">מנהלים סקר, הרשמה,
            קבוצות ודירוגים במקום אחד.</p></div>
        <form className="space-y-3" onSubmit={submit}>{mode === 'signup' && <>
            <div className="grid grid-cols-2 gap-2"><Input placeholder="שם פרטי" value={f.first_name}
                                                           onChange={e => set('first_name', e.target.value)}
                                                           required/><Input placeholder="שם משפחה" value={f.last_name}
                                                                            onChange={e => set('last_name', e.target.value)}
                                                                            required/></div>
            <Input type="date" value={f.birth_date} onChange={e => set('birth_date', e.target.value)}/>
            <div className="grid grid-cols-2 gap-2"><Select value={f.preferred_position}
                                                            onChange={e => set('preferred_position', e.target.value)}>
                <option value="goalkeeper">שוער</option>
                <option value="defender">מגן</option>
                <option value="midfielder">קשר</option>
                <option value="winger">כנף</option>
                <option value="striker">חלוץ</option>
                <option value="utility">כללי</option>
            </Select><Select value={f.preferred_foot} onChange={e => set('preferred_foot', e.target.value)}>
                <option value="right">ימין</option>
                <option value="left">שמאל</option>
                <option value="both">שתי רגליים</option>
            </Select></div>
        </>}
            <div className="flex flex-row items-center gap-1 form-control"><Mail className=" text-[#718078]" size={18}/><Input
                className="!border-0 focus:!border-0 focus:!ring-0 !p-0" type="email" placeholder="אימייל" value={f.email}
                onChange={e => set('email', e.target.value)} required/></div>
            <div className="flex flex-row items-center gap-1 form-control"><LockKeyhole className="text-[#718078]" size={18}/><Input
                className="!border-0 focus:!border-0 focus:!ring-0 !p-0" type="password" minLength={6} placeholder="סיסמה" value={f.password}
                onChange={e => set('password', e.target.value)} required/></div>
            <Button disabled={busy}
                    className="w-full">{busy ? 'מתחבר...' : mode === 'login' ? 'כניסה ל־TEAMUP' : 'יצירת חשבון'}</Button>
        </form>
        <button type="button" className="mt-5 w-full text-sm text-[#83bc98]"
                onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'אין לך חשבון? הרשמה' : 'כבר נרשמת? התחברות'}</button>
    </Card></div>
}

import {useState} from 'react';
import {ArrowLeft,CalendarDays,Check,CheckCircle2,Eye,EyeOff,Footprints,Goal,LockKeyhole,Mail,ShieldCheck,Shuffle,UserRound,Users} from 'lucide-react';
import {toast} from 'sonner';
import {Button,Input,Select} from '../components/ui';
import {isSupabaseConfigured,supabase} from '../lib/supabase';

type Mode='login'|'signup';

const authError=(message:string)=>{
 const value=message.toLowerCase();
 if(value.includes('invalid login credentials'))return 'האימייל או הסיסמה אינם נכונים.';
 if(value.includes('email not confirmed'))return 'צריך לאמת את כתובת המייל לפני ההתחברות.';
 if(value.includes('user already registered')||value.includes('already been registered'))return 'כבר קיים חשבון עם כתובת המייל הזו.';
 if(value.includes('password should be at least'))return 'הסיסמה צריכה להכיל לפחות 6 תווים.';
 if(value.includes('unable to validate email')||value.includes('invalid email'))return 'כתובת המייל אינה תקינה.';
 if(value.includes('rate limit')||value.includes('too many requests'))return 'בוצעו יותר מדי ניסיונות. המתן מעט ונסה שוב.';
 return 'לא הצלחנו להשלים את הפעולה. בדוק את הפרטים ונסה שוב.';
};

export default function AuthPage(){
 const [mode,setMode]=useState<Mode>('login');
 const [busy,setBusy]=useState(false);
 const [showPassword,setShowPassword]=useState(false);
 const [confirmPassword,setConfirmPassword]=useState('');
 const [formError,setFormError]=useState('');
 const [signupEmail,setSignupEmail]=useState('');
 const [f,setF]=useState({email:'',password:'',first_name:'',last_name:'',birth_date:'',preferred_position:'',preferred_foot:''});
 const set=(key:string,value:string)=>{setFormError('');setF(current=>({...current,[key]:value}))};
 const changeMode=(next:Mode)=>{setMode(next);setFormError('');setConfirmPassword('');setShowPassword(false)};

 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();
  setFormError('');
  if(!isSupabaseConfigured){toast.error('החיבור למערכת אינו מוגדר כרגע.');return}
  const email=f.email.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email)){setFormError('יש להזין כתובת אימייל תקינה.');return}
  if(f.password.length<6){setFormError('הסיסמה צריכה להכיל לפחות 6 תווים.');return}
  if(mode==='signup'){
   if(!f.first_name.trim()||!f.last_name.trim()){setFormError('יש להזין שם פרטי ושם משפחה.');return}
   if(f.password!==confirmPassword){setFormError('הסיסמאות אינן תואמות.');return}
   if(!f.preferred_position||!f.preferred_foot){setFormError('יש לבחור עמדה ורגל מועדפת.');return}
  }
  setBusy(true);
  try{
   if(mode==='login'){
    const {error}=await supabase.auth.signInWithPassword({email,password:f.password});
    if(error)throw error;
    toast.success('התחברת בהצלחה');
   }else{
    const {data,error}=await supabase.auth.signUp({
     email,password:f.password,
     options:{data:{
      first_name:f.first_name.trim(),last_name:f.last_name.trim(),birth_date:f.birth_date||null,
      preferred_position:f.preferred_position,preferred_positions:[f.preferred_position],preferred_foot:f.preferred_foot
     }}
    });
    if(error)throw error;
    if(!data.session)setSignupEmail(email);
    toast.success(data.session?'החשבון נוצר בהצלחה':'שלחנו אליך קישור לאימות המייל');
   }
  }catch(error){
   const message=authError(error instanceof Error?error.message:'');
   setFormError(message);
   toast.error(message);
  }finally{setBusy(false)}
 };

 if(signupEmail)return <main className="auth-screen"><div className="auth-orb auth-orb-one"/><div className="auth-orb auth-orb-two"/><section className="auth-success" aria-live="polite"><div className="auth-success-icon"><Mail size={34}/><CheckCircle2 size={18}/></div><span className="auth-eyebrow">כמעט סיימנו</span><h1>בדוק את תיבת המייל</h1><p>שלחנו קישור אימות אל</p><strong dir="ltr">{signupEmail}</strong><div className="auth-info-box"><ShieldCheck size={20}/><span>אחרי האימות אפשר לחזור לכאן ולהתחבר לחשבון החדש.</span></div><Button className="w-full" onClick={()=>{setSignupEmail('');changeMode('login')}}><ArrowLeft size={18}/>חזרה להתחברות</Button></section></main>;

 return <main className="auth-screen">
  <div className="auth-orb auth-orb-one"/><div className="auth-orb auth-orb-two"/>
  <div className="auth-layout">
   <aside className="auth-showcase">
    <div className="auth-brand"><span><Goal size={30}/></span><div><strong>TEAMUP</strong><small>הקבוצה שלך. המשחק שלך.</small></div></div>
    <div className="auth-pitch" aria-hidden="true"><span className="pitch-line pitch-half"/><span className="pitch-circle"/><i className="pitch-player p1"/><i className="pitch-player p2"/><i className="pitch-player p3"/><i className="pitch-player p4"/><i className="pitch-ball"><Goal size={16}/></i></div>
    <div className="auth-copy"><span className="auth-eyebrow">הכול במקום אחד</span><h1>מארגנים משחק.<br/>עולים למגרש.</h1><p>הרשמה, חלוקת קבוצות, שערים, דירוגים וסטטיסטיקות — בלי לרדוף אחרי הודעות בקבוצה.</p></div>
    <div className="auth-feature-list"><div><CalendarDays/><span><b>ניהול משחקים</b><small>הרשמה ונוכחות בזמן אמת</small></span></div><div><Shuffle/><span><b>קבוצות מאוזנות</b><small>חלוקה חכמה ומהירה</small></span></div><div><Users/><span><b>הקבוצה מחוברת</b><small>נתונים, דירוגים והישגים</small></span></div></div>
   </aside>

   <section className="auth-panel">
    <div className="auth-mobile-brand"><span><Goal size={23}/></span><strong>TEAMUP</strong></div>
    <div className="auth-heading"><span className="auth-eyebrow">{mode==='login'?'טוב שחזרת':'מצטרפים למגרש'}</span><h2>{mode==='login'?'כניסה לחשבון':'יצירת חשבון חדש'}</h2><p>{mode==='login'?'הזן את הפרטים שלך והמשך לקבוצה.':'כמה פרטים קצרים, ומיד אפשר להתחיל לשחק.'}</p></div>
    <div className="auth-tabs" role="tablist" aria-label="בחירת סוג פעולה"><button type="button" role="tab" aria-selected={mode==='login'} className={mode==='login'?'active':''} onClick={()=>changeMode('login')}>התחברות</button><button type="button" role="tab" aria-selected={mode==='signup'} className={mode==='signup'?'active':''} onClick={()=>changeMode('signup')}>הרשמה</button></div>

    <form className="auth-form" onSubmit={submit} noValidate>
     {mode==='signup'&&<div className="auth-form-section"><div className="auth-section-title"><span>1</span><div><strong>מי אתה?</strong><small>הפרטים שיופיעו בכרטיס השחקן</small></div></div><div className="auth-field-grid"><label className="auth-field"><span>שם פרטי</span><div className="auth-input-wrap"><UserRound size={18}/><Input autoComplete="given-name" value={f.first_name} onChange={e=>set('first_name',e.target.value)} placeholder="לדוגמה: נתי" required/></div></label><label className="auth-field"><span>שם משפחה</span><div className="auth-input-wrap"><UserRound size={18}/><Input autoComplete="family-name" value={f.last_name} onChange={e=>set('last_name',e.target.value)} placeholder="שם משפחה" required/></div></label></div><label className="auth-field"><span>תאריך לידה <small>(לא חובה)</small></span><div className="auth-input-wrap"><CalendarDays size={18}/><Input type="date" autoComplete="bday" value={f.birth_date} onChange={e=>set('birth_date',e.target.value)}/></div></label><div className="auth-field-grid"><label className="auth-field"><span>עמדה מועדפת</span><div className="auth-input-wrap"><Goal size={18}/><Select value={f.preferred_position} required onChange={e=>set('preferred_position',e.target.value)}><option value="" disabled>בחר עמדה</option><option value="goalkeeper">שוער</option><option value="defender">מגן</option><option value="midfielder">קשר</option><option value="winger">כנף</option><option value="striker">חלוץ</option><option value="utility">כללי</option></Select></div></label><label className="auth-field"><span>רגל מועדפת</span><div className="auth-input-wrap"><Footprints size={18}/><Select value={f.preferred_foot} required onChange={e=>set('preferred_foot',e.target.value)}><option value="" disabled>בחר רגל</option><option value="right">ימין</option><option value="left">שמאל</option><option value="both">שתי רגליים</option></Select></div></label></div></div>}

     <div className="auth-form-section"><div className="auth-section-title">{mode==='signup'&&<span>2</span>}<div><strong>{mode==='login'?'פרטי התחברות':'פרטי החשבון'}</strong>{mode==='signup'&&<small>האימייל והסיסמה נשארים פרטיים</small>}</div></div><label className="auth-field"><span>כתובת אימייל</span><div className="auth-input-wrap" dir="ltr"><Mail size={18}/><Input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" value={f.email} onChange={e=>set('email',e.target.value)} placeholder="name@example.com" required/></div></label><label className="auth-field"><span>סיסמה</span><div className="auth-input-wrap" dir="ltr"><LockKeyhole size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete={mode==='login'?'current-password':'new-password'} value={f.password} onChange={e=>set('password',e.target.value)} placeholder="לפחות 6 תווים" required/><button type="button" className="auth-password-toggle" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'הסתרת סיסמה':'הצגת סיסמה'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>{mode==='signup'&&<label className="auth-field"><span>אימות סיסמה</span><div className="auth-input-wrap" dir="ltr"><Check size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete="new-password" value={confirmPassword} onChange={e=>{setFormError('');setConfirmPassword(e.target.value)}} placeholder="הקלד שוב את הסיסמה" required/></div></label>}</div>

     {formError&&<div className="auth-error" role="alert">{formError}</div>}
     <Button className="auth-submit" disabled={busy}>{busy?(mode==='login'?'מתחברים...':'יוצרים חשבון...'):(mode==='login'?'כניסה ל־TEAMUP':'יצירת חשבון')} {!busy&&<ArrowLeft size={18}/>}</Button>
     {mode==='signup'&&<p className="auth-terms"><ShieldCheck size={15}/>ביצירת החשבון אתה מאשר שימוש בפרטים לצורך ניהול הקבוצה והמשחקים בלבד.</p>}
    </form>
   </section>
  </div>
 </main>;
}

import {useState} from 'react';
import {ArrowLeft,CalendarDays,Check,CheckCircle2,Eye,EyeOff,Footprints,Goal,LockKeyhole,Mail,ShieldCheck,Shuffle,UserRound,Users} from 'lucide-react';
import {toast} from 'sonner';
import {Button,Input,Select} from '../components/ui';
import {useAuth} from '../contexts/AuthContext';
import {isSupabaseConfigured,supabase} from '../lib/supabase';

type Mode='login'|'signup';

const authError=(message:string)=>{
 const value=message.toLowerCase();
 if(value.includes('invalid login credentials'))return 'האימייל או הסיסמה אינם נכונים.';
 if(value.includes('email not confirmed'))return 'צריך לאמת את כתובת המייל לפני ההתחברות.';
 if(value.includes('user already registered')||value.includes('already been registered'))return 'כבר קיים חשבון עם כתובת המייל הזו.';
 if(value.includes('password should be at least'))return 'הסיסמה צריכה להכיל לפחות 6 תווים.';
 if(value.includes('different from the old password')||value.includes('same password'))return 'יש לבחור סיסמה חדשה ששונה מהסיסמה הקודמת.';
 if(value.includes('unable to validate email')||value.includes('invalid email'))return 'כתובת המייל אינה תקינה.';
 if(value.includes('rate limit')||value.includes('too many requests'))return 'בוצעו יותר מדי ניסיונות. המתן מעט ונסה שוב.';
 return 'לא הצלחנו להשלים את הפעולה. בדוק את הפרטים ונסה שוב.';
};

const recoveryLinkError=()=>{
 const params=new URLSearchParams(window.location.hash.replace(/^#/,''));
 const code=params.get('error_code');
 if(code==='otp_expired')return 'קישור השחזור פג תוקף או כבר נוצל. אפשר לבקש קישור חדש.';
 return params.get('error')?'קישור השחזור אינו תקין. אפשר לבקש קישור חדש.':'';
};

export default function AuthPage(){
 const {passwordRecovery,finishPasswordRecovery,signOut}=useAuth();
 const [mode,setMode]=useState<Mode>('login');
 const [forgot,setForgot]=useState(false);
 const [busy,setBusy]=useState(false);
 const [showPassword,setShowPassword]=useState(false);
 const [confirmPassword,setConfirmPassword]=useState('');
 const [formError,setFormError]=useState(recoveryLinkError);
 const [emailNotice,setEmailNotice]=useState<{kind:'signup'|'recovery';email:string}|null>(null);
 const [f,setF]=useState({email:'',password:'',first_name:'',last_name:'',birth_date:'',preferred_position:'',preferred_foot:''});
 const set=(key:string,value:string)=>{setFormError('');setF(current=>({...current,[key]:value}))};
 const changeMode=(next:Mode)=>{setMode(next);setForgot(false);setFormError('');setConfirmPassword('');setShowPassword(false)};

 const submit=async(event:React.FormEvent)=>{
  event.preventDefault();
  setFormError('');
  if(!isSupabaseConfigured){toast.error('החיבור למערכת אינו מוגדר כרגע.');return}
  const email=f.email.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email)){setFormError('יש להזין כתובת אימייל תקינה.');return}
  if(forgot){
   setBusy(true);
   try{
    const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/`});
    if(error)throw error;
    setEmailNotice({kind:'recovery',email});
    toast.success('אם קיים חשבון עם המייל הזה, קישור שחזור נשלח אליו');
   }catch(error){const message=authError(error instanceof Error?error.message:'');setFormError(message);toast.error(message)}
   finally{setBusy(false)}
   return;
  }
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
    if(!data.session)setEmailNotice({kind:'signup',email});
    toast.success(data.session?'החשבון נוצר בהצלחה':'שלחנו אליך קישור לאימות המייל');
   }
  }catch(error){
   const message=authError(error instanceof Error?error.message:'');
   setFormError(message);
   toast.error(message);
 }finally{setBusy(false)}
 };

 const updatePassword=async(event:React.FormEvent)=>{
  event.preventDefault();setFormError('');
  if(f.password.length<6){setFormError('הסיסמה צריכה להכיל לפחות 6 תווים.');return}
  if(f.password!==confirmPassword){setFormError('הסיסמאות אינן תואמות.');return}
  setBusy(true);
  try{
   const {error}=await supabase.auth.updateUser({password:f.password});
   if(error)throw error;
   toast.success('הסיסמה עודכנה בהצלחה');
   finishPasswordRecovery();
  }catch(error){const message=authError(error instanceof Error?error.message:'');setFormError(message);toast.error(message)}
  finally{setBusy(false)}
 };

 if(passwordRecovery)return <main className="auth-screen"><div className="auth-orb auth-orb-one"/><div className="auth-orb auth-orb-two"/><section className="auth-success auth-reset-card"><div className="auth-success-icon"><LockKeyhole size={34}/><CheckCircle2 size={18}/></div><span className="auth-eyebrow">שחזור סיסמה</span><h1>בחירת סיסמה חדשה</h1><p>בחר סיסמה חדשה לחשבון שלך.</p><form className="auth-form" onSubmit={updatePassword} noValidate><label className="auth-field"><span>סיסמה חדשה</span><div className="auth-input-wrap" dir="ltr"><LockKeyhole size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete="new-password" value={f.password} onChange={e=>set('password',e.target.value)} placeholder="לפחות 6 תווים" required/><button type="button" className="auth-password-toggle" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'הסתרת סיסמה':'הצגת סיסמה'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label><label className="auth-field"><span>אימות הסיסמה החדשה</span><div className="auth-input-wrap" dir="ltr"><Check size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete="new-password" value={confirmPassword} onChange={e=>{setFormError('');setConfirmPassword(e.target.value)}} placeholder="הקלד שוב את הסיסמה" required/></div></label>{formError&&<div className="auth-error" role="alert">{formError}</div>}<Button className="auth-submit" disabled={busy}>{busy?'מעדכנים סיסמה...':'שמירת הסיסמה החדשה'}{!busy&&<Check size={18}/>}</Button><button type="button" className="auth-back-link" onClick={async()=>{await signOut();finishPasswordRecovery()}}>ביטול וחזרה להתחברות</button></form></section></main>;

 if(emailNotice)return <main className="auth-screen"><div className="auth-orb auth-orb-one"/><div className="auth-orb auth-orb-two"/><section className="auth-success" aria-live="polite"><div className="auth-success-icon"><Mail size={34}/><CheckCircle2 size={18}/></div><span className="auth-eyebrow">{emailNotice.kind==='signup'?'כמעט סיימנו':'שחזור סיסמה'}</span><h1>בדוק את תיבת המייל</h1><p>{emailNotice.kind==='signup'?'שלחנו קישור אימות אל':'אם קיים חשבון עם הכתובת הזו, שלחנו אליו קישור שחזור:'}</p><strong dir="ltr">{emailNotice.email}</strong><div className="auth-info-box"><ShieldCheck size={20}/><span>{emailNotice.kind==='signup'?'אחרי האימות אפשר לחזור לכאן ולהתחבר לחשבון החדש.':'פתח את הקישור במכשיר שבו תרצה לבחור סיסמה חדשה. מטעמי אבטחה הקישור תקף לזמן מוגבל.'}</span></div><Button className="w-full" onClick={()=>{setEmailNotice(null);changeMode('login')}}><ArrowLeft size={18}/>חזרה להתחברות</Button></section></main>;

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
    <div className="auth-heading"><span className="auth-eyebrow">{forgot?'חוזרים למגרש':mode==='login'?'טוב שחזרת':'מצטרפים למגרש'}</span><h2>{forgot?'שחזור סיסמה':mode==='login'?'כניסה לחשבון':'יצירת חשבון חדש'}</h2><p>{forgot?'הזן את כתובת המייל ונשלח אליך קישור מאובטח לבחירת סיסמה חדשה.':mode==='login'?'הזן את הפרטים שלך והמשך לקבוצה.':'כמה פרטים קצרים, ומיד אפשר להתחיל לשחק.'}</p></div>
    {!forgot&&<div className="auth-tabs" role="tablist" aria-label="בחירת סוג פעולה"><button type="button" role="tab" aria-selected={mode==='login'} className={mode==='login'?'active':''} onClick={()=>changeMode('login')}>התחברות</button><button type="button" role="tab" aria-selected={mode==='signup'} className={mode==='signup'?'active':''} onClick={()=>changeMode('signup')}>הרשמה</button></div>}

    <form className="auth-form" onSubmit={submit} noValidate>
     {mode==='signup'&&<div className="auth-form-section"><div className="auth-section-title"><span>1</span><div><strong>מי אתה?</strong><small>הפרטים שיופיעו בכרטיס השחקן</small></div></div><div className="auth-field-grid"><label className="auth-field"><span>שם פרטי</span><div className="auth-input-wrap"><UserRound size={18}/><Input autoComplete="given-name" value={f.first_name} onChange={e=>set('first_name',e.target.value)} placeholder="שם פרטי" required/></div></label><label className="auth-field"><span>שם משפחה</span><div className="auth-input-wrap"><UserRound size={18}/><Input autoComplete="family-name" value={f.last_name} onChange={e=>set('last_name',e.target.value)} placeholder="שם משפחה" required/></div></label></div><label className="auth-field"><span>תאריך לידה <small>(לא חובה)</small></span><div className="auth-input-wrap"><CalendarDays size={18}/><Input type="date" autoComplete="bday" value={f.birth_date} onChange={e=>set('birth_date',e.target.value)}/></div></label><div className="auth-field-grid"><label className="auth-field"><span>עמדה מועדפת</span><div className="auth-input-wrap"><Goal size={18}/><Select value={f.preferred_position} required onChange={e=>set('preferred_position',e.target.value)}><option value="" disabled>בחר עמדה</option><option value="goalkeeper">שוער</option><option value="defender">מגן</option><option value="midfielder">קשר</option><option value="winger">כנף</option><option value="striker">חלוץ</option><option value="utility">כללי</option></Select></div></label><label className="auth-field"><span>רגל מועדפת</span><div className="auth-input-wrap"><Footprints size={18}/><Select value={f.preferred_foot} required onChange={e=>set('preferred_foot',e.target.value)}><option value="" disabled>בחר רגל</option><option value="right">ימין</option><option value="left">שמאל</option><option value="both">שתי רגליים</option></Select></div></label></div></div>}

     <div className="auth-form-section"><div className="auth-section-title">{mode==='signup'&&<span>2</span>}<div><strong>{forgot?'לאיזה חשבון לשלוח?':mode==='login'?'פרטי התחברות':'פרטי החשבון'}</strong>{mode==='signup'&&<small>האימייל והסיסמה נשארים פרטיים</small>}</div></div><label className="auth-field"><span>כתובת אימייל</span><div className="auth-input-wrap" dir="ltr"><Mail size={18}/><Input type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" value={f.email} onChange={e=>set('email',e.target.value)} placeholder="name@example.com" required/></div></label>{!forgot&&<label className="auth-field"><span>סיסמה</span><div className="auth-input-wrap" dir="ltr"><LockKeyhole size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete={mode==='login'?'current-password':'new-password'} value={f.password} onChange={e=>set('password',e.target.value)} placeholder="לפחות 6 תווים" required/><button type="button" className="auth-password-toggle" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'הסתרת סיסמה':'הצגת סיסמה'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>}{mode==='signup'&&!forgot&&<label className="auth-field"><span>אימות סיסמה</span><div className="auth-input-wrap" dir="ltr"><Check size={18}/><Input type={showPassword?'text':'password'} minLength={6} autoComplete="new-password" value={confirmPassword} onChange={e=>{setFormError('');setConfirmPassword(e.target.value)}} placeholder="הקלד שוב את הסיסמה" required/></div></label>}{mode==='login'&&!forgot&&<button type="button" className="auth-forgot-link" onClick={()=>{setForgot(true);setFormError('')}}>שכחת את הסיסמה?</button>}</div>

     {formError&&<div className="auth-error" role="alert">{formError}</div>}
     <Button className="auth-submit" disabled={busy}>{busy?(forgot?'שולחים קישור...':mode==='login'?'מתחברים...':'יוצרים חשבון...'):(forgot?'שליחת קישור לשחזור':mode==='login'?'כניסה ל־TEAMUP':'יצירת חשבון')} {!busy&&<ArrowLeft size={18}/>}</Button>
     {forgot&&<button type="button" className="auth-back-link" onClick={()=>{setForgot(false);setFormError('')}}>חזרה להתחברות</button>}
     {mode==='signup'&&<p className="auth-terms"><ShieldCheck size={15}/>ביצירת החשבון אתה מאשר שימוש בפרטים לצורך ניהול הקבוצה והמשחקים בלבד.</p>}
    </form>
   </section>
  </div>
 </main>;
}

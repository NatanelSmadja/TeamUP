import {useEffect,useMemo,useState} from 'react';
import {Activity,BarChart3,CalendarDays,ChevronDown,Database,History,Home,Layers3,LogOut,Menu,Plus,Settings,Shield,UsersRound,UserRound,X,Zap} from 'lucide-react';
import {NavLink,Outlet,useLocation,useNavigate} from 'react-router-dom';
import {cn} from '../lib/utils';
import {useGroup,canManage,isSystemAdmin} from '../hooks/useGroup';
import {useAuth} from '../contexts/AuthContext';
import AppInstallBanner from './AppInstallBanner';
import NotificationCenter from './NotificationCenter';

const base=[
  ['/','בית',Home],
  ['/groups','קבוצות',Layers3],
  ['/availability','סקר',CalendarDays],
  ['/squad','קבוצה',UsersRound],
  ['/stats','סטטיסטיקות',BarChart3],
  ['/activity','פעילות',Activity],
  ['/history','היסטוריה',History],
] as const;

const primaryMobilePaths=['/','/groups','/availability','/squad'];

export default function Layout(){
  const {data:g,memberships,setActiveGroupId}=useGroup();
  const navigate=useNavigate();
  const location=useLocation();
  const {profile,signOut}=useAuth();
  const [moreOpen,setMoreOpen]=useState(false);
  const [groupOpen,setGroupOpen]=useState(false);

  const links=useMemo(()=>{
    const next:any[]=[...base];
    if(canManage(g))next.push(['/admin','ניהול קבוצה',Shield],['/group-settings','הגדרות קבוצה',Settings]);
    if(isSystemAdmin(profile))next.push(['/system-admin','מערכת',Database]);
    return next;
  },[g,profile]);

  const primaryMobile=links.filter(([to])=>primaryMobilePaths.includes(to));
  const moreMobile=links.filter(([to])=>!primaryMobilePaths.includes(to));
  const moreIsActive=moreMobile.some(([to])=>location.pathname===to||location.pathname.startsWith(`${to}/`));

  useEffect(()=>{setMoreOpen(false);setGroupOpen(false)},[location.pathname]);
  useEffect(()=>{
    if(!moreOpen)return;
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous};
  },[moreOpen]);

  const chooseGroup=(id:string)=>{
    setActiveGroupId(id);
    setGroupOpen(false);
    navigate('/');
  };

  return <div className="app-shell">
    <aside className="desktop-sidebar">
      <div className="brand-mark"><span>⚽</span><div><strong>TEAMUP</strong><small>Multi‑Club Platform</small></div></div>
      <nav>{links.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/' } className={({isActive})=>cn('side-link',isActive&&'active')}><Icon size={20}/><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-profile"><NavLink to="/profile"><UserRound size={20}/><span>{profile?.first_name||'פרופיל'}</span></NavLink><button onClick={signOut} title="יציאה מהחשבון"><LogOut size={19}/></button></div>
    </aside>

    <div className="content-shell">
      <header className="desktop-topbar">
        <div><p>TEAMUP CLUB</p><div className="topbar-group-row"><span className="group-color-dot" style={{background:g?.group.theme_color||'#2563eb'}}/><h2>{g?.group.name||'הקבוצה שלי'}</h2>{memberships.length>1&&<select value={g?.group.id||''} onChange={e=>setActiveGroupId(e.target.value)}>{memberships.map(x=><option key={x.group.id} value={x.group.id}>{x.group.name}</option>)}</select>}</div></div>
        <div className="topbar-actions"><NotificationCenter/><NavLink to="/profile" className="profile-chip"><UserRound size={19}/>{profile?.first_name||'פרופיל'}</NavLink></div>
      </header>

      <header className="mobile-topbar safe-top">
        <button className="mobile-group-button" onClick={()=>setGroupOpen(v=>!v)} aria-expanded={groupOpen}>
          <span className="mobile-group-logo" style={{background:g?.group.theme_color||'#2563eb'}}>{g?.group.name?.trim()?.slice(0,1)||'T'}</span>
          <span><small>הקבוצה הפעילה</small><strong>{g?.group.name||'בחירת קבוצה'}</strong></span>
          {memberships.length>1&&<ChevronDown size={18} className={cn(groupOpen&&'rotate-180')}/>} 
        </button>
        <div className="mobile-top-actions"><NotificationCenter/><NavLink to="/profile" className="mobile-avatar" aria-label="פרופיל">{profile?.first_name?.trim()?.slice(0,1)||<UserRound size={18}/>}</NavLink></div>
        {groupOpen&&memberships.length>1&&<div className="mobile-group-menu card">
          <div className="mobile-group-menu-head"><strong>מעבר קבוצה</strong><NavLink to="/groups">ניהול קבוצות</NavLink></div>
          {memberships.map(x=><button key={x.group.id} onClick={()=>chooseGroup(x.group.id)} className={cn(x.group.id===g?.group.id&&'active')}><span className="group-color-dot" style={{background:x.group.theme_color||'#2563eb'}}/><span><strong>{x.group.name}</strong><small>{x.member.role==='admin'?'מנהל קבוצה':'שחקן'}</small></span>{x.group.id===g?.group.id&&<span className="active-check">פעילה</span>}</button>)}
        </div>}
      </header>

      <AppInstallBanner/>
      <main className="page-wrap"><Outlet/></main>
      {canManage(g)&&<div className="quick-fab"><button title="פעולות מהירות" onClick={()=>navigate('/admin')}><Zap size={20}/><span>פעולות מהירות</span><Plus size={17}/></button></div>}
    </div>

    <nav className="mobile-nav safe-bottom">
      {primaryMobile.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/' } className={({isActive})=>cn('mobile-link',isActive&&'active')}><Icon size={21}/><span>{label}</span></NavLink>)}
      <button className={cn('mobile-link mobile-more-button',moreIsActive&&'active')} onClick={()=>setMoreOpen(true)}><Menu size={22}/><span>עוד</span></button>
    </nav>

    {moreOpen&&<div className="mobile-sheet-layer" role="dialog" aria-modal="true" aria-label="תפריט נוסף">
      <button className="mobile-sheet-backdrop" aria-label="סגירת תפריט" onClick={()=>setMoreOpen(false)}/>
      <section className="mobile-more-sheet safe-bottom">
        <div className="sheet-handle"/>
        <div className="mobile-sheet-head"><div><small>TEAMUP</small><h2>כל הכלים שלך</h2></div><button onClick={()=>setMoreOpen(false)} aria-label="סגירה"><X size={21}/></button></div>
        <div className="mobile-sheet-user">
          <NavLink to="/profile"><span className="mobile-sheet-avatar">{profile?.first_name?.trim()?.slice(0,1)||'U'}</span><span><strong>{profile?.first_name||'הפרופיל שלי'}</strong><small>פרופיל, עמדות והגדרות</small></span></NavLink>
          <button onClick={signOut}><LogOut size={19}/><span>יציאה</span></button>
        </div>
        <div className="mobile-more-grid">
          {moreMobile.map(([to,label,Icon])=><NavLink key={to} to={to} className={({isActive})=>cn('mobile-more-card',isActive&&'active')}><span className="mobile-more-icon"><Icon size={23}/></span><strong>{label}</strong><small>{mobileDescription(to)}</small></NavLink>)}
        </div>
      </section>
    </div>}
  </div>
}

function mobileDescription(path:string){
  const descriptions:Record<string,string>={
    '/stats':'דירוגים, הישגים ומובילים',
    '/activity':'כל מה שקרה בקבוצה',
    '/history':'משחקים קודמים ותוצאות',
    '/admin':'משחקים, סקרים ופעולות',
    '/group-settings':'חברים, הזמנות והרשאות',
    '/system-admin':'ניהול פלטפורמת TEAMUP',
  };
  return descriptions[path]||'פתיחת המסך';
}

import {useMemo, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useParams} from 'react-router-dom';
import {ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, GripVertical, Lock, LockOpen, MapPin, MessageCircle, RefreshCcw, Repeat2, ShieldCheck, Star, Trash2, Undo2, UserPlus, UserX, Users} from 'lucide-react';
import {toast} from 'sonner';
import {Badge, Button, Card, Select} from '../components/ui';
import {MatchSkeleton} from '../components/Skeletons';
import {useAuth} from '../contexts/AuthContext';
import {fullName, statusLabel, positionLabel} from '../lib/utils';
import {supabase} from '../lib/supabase';
import type {Match, Registration} from '../types';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {useGroup, canManage, isSystemAdmin} from '../hooks/useGroup';
import {GoalCenter} from '../components/GoalCenter';

const colorNames: any = {
  red: 'אדומים',
  blue: 'כחולים',
  yellow: 'צהובים',
  green: 'ירוקים',
};
const calcBalance = (teams: any[]) => {
  const ratings = teams.map((t) => {
    const vals = t.team_players.map((p: any) => Number(p.profiles?.base_rating || 3));
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
  });
  return ratings.length ? Math.max(0, Math.round(100 - (Math.max(...ratings) - Math.min(...ratings)) * 20)) : 0;
};
const matchEndAt = (match: Match) => {
  const start = new Date(`${match.match_date}T${match.start_time}`);
  if (!match.end_time) return new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const end = new Date(`${match.match_date}T${match.end_time}`);
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  return end;
};

export default function MatchPage() {
  const {id} = useParams();
  const {user, profile} = useAuth();
  const {data: g} = useGroup();
  const canEditTeams = canManage(g, 'edit_teams');
  const canGenerateTeams = canManage(g, 'generate_teams');
  const canCloseRegistration = canManage(g, 'close_registration');
  const canManageResults = canManage(g, 'enter_results');
  const canOpenRatings = canManage(g, 'open_ratings');
  const qc = useQueryClient();
  const [dragged, setDragged] = useState<string | null>(null);
  const [swapFirst, setSwapFirst] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const key = ['match', id] as const;
  const q = useQuery({
    queryKey: key,
    enabled: !!id,
    refetchInterval: 15000,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('get_member_match_details', {
        p_match_id: id,
      });
      if (!error) {
        const details = data as {
          match?: Match;
          regs?: Registration[];
          teams?: any[];
        } | null;
        if (details?.match) {
          const teams = details.teams || [];
          const latest = teams.length ? Math.max(...teams.map((x: any) => x.generation_version)) : 0;
          return {
            match: details.match,
            regs: details.regs || [],
            teams: teams.filter((x: any) => x.generation_version === latest),
          };
        }
      }
      console.error('[TEAMUP match] Falling back to direct match reads', {
        matchId: id,
        code: error?.code,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        response: data,
      });
      const {data: match, error: matchError} = await supabase.from('matches').select('*').eq('id', id).maybeSingle();
      if (matchError || !match) {
        console.error('[TEAMUP match] Match row is not visible', {
          matchId: id,
          error: matchError,
        });
        throw matchError || new Error('המשחק לא נמצא או שאין לך גישה אליו');
      }
      const [{data: regs, error: regsError}, {data: teams, error: teamsError}] = await Promise.all([supabase.from('match_registrations').select('*,profiles!match_registrations_user_id_fkey(*)').eq('match_id', id).order('registered_at'), supabase.from('teams').select('*,team_players(*,profiles(*))').eq('match_id', id).eq('is_published', true).order('generation_version', {ascending: false}).order('team_number')]);
      if (regsError)
        console.warn('[TEAMUP match] Registrations were not available', {
          matchId: id,
          error: regsError,
        });
      if (teamsError)
        console.warn('[TEAMUP match] Teams were not available', {
          matchId: id,
          error: teamsError,
        });
      const rows = teams || [];
      const latest = rows.length ? Math.max(...rows.map((x: any) => x.generation_version)) : 0;
      return {
        match: match as Match,
        regs: (regs || []) as Registration[],
        teams: rows.filter((x: any) => x.generation_version === latest),
      };
    },
  });
  useRealtimeInvalidation(`match-${id}`, ['matches', 'match_registrations', 'teams', 'team_players', 'player_ratings', 'team_edit_history', 'goal_events'], [key, ['v2-home']], !!id);
  const canManageRegistrations = isSystemAdmin(profile) || (!!g && g.group.id === q.data?.match.group_id && canManage(g, 'manage_registrations'));
  const members = useQuery({
    queryKey: ['match-registration-members', q.data?.match.group_id],
    enabled: !!q.data?.match.group_id && canManageRegistrations,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('get_match_registration_candidates', {p_match_id: id});
      if (error) throw error;
      return data || [];
    },
  });
  const mine = useMemo(() => q.data?.regs.find((x) => x.user_id === user?.id), [q.data, user]);
  const act = useMutation({
    mutationFn: async (response: 'attending' | 'unavailable') => {
      const {error} = await supabase.rpc('respond_to_match', {
        p_match_id: id,
        p_response: response,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('הבחירה נשמרה');
      qc.invalidateQueries({queryKey: key});
    },
    onError: (e) => toast.error(e.message),
  });
  const refresh = () => qc.invalidateQueries({queryKey: key});
  const manageRegistration = useMutation({
    mutationFn: async ({userId, attending}: {userId: string; attending: boolean}) => {
      const {data, error} = await supabase.rpc('manage_match_registration', {
        p_match_id: id,
        p_user_id: userId,
        p_attending: attending,
      });
      if (error) throw error;
      return data as {status?: string; player_name?: string};
    },
    onSuccess: async (result, variables) => {
      setSelectedPlayer('');
      await refresh();
      qc.invalidateQueries({queryKey: ['v2-home']});
      const destination = result?.status === 'waitlisted' ? ' לרשימת ההמתנה' : '';
      toast.success(variables.attending ? `${result?.player_name || 'השחקן'} נוסף${destination}` : `${result?.player_name || 'השחקן'} הוסר מהרשימה`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const lifecycle = useMutation({
    mutationFn: async (action: 'close' | 'open' | 'reopenPublished' | 'generate' | 'complete') => {
      const request = action === 'close'
        ? ['set_match_registration', {p_match_id: id, p_open: false}]
        : action === 'open'
          ? ['set_match_registration', {p_match_id: id, p_open: true}]
          : action === 'reopenPublished'
            ? ['reopen_published_match_registration', {p_match_id: id}]
          : action === 'generate'
            ? ['generate_balanced_teams', {p_match_id: id}]
            : ['complete_match', {p_match_id: id}];
      const {error} = await supabase.rpc(request[0] as string, request[1]);
      if (error) throw error;
      return action;
    },
    onSuccess: async (action) => {
      toast.success({close: 'ההרשמה נסגרה', open: 'ההרשמה נפתחה מחדש', reopenPublished: 'החלוקה בוטלה וההרשמה נפתחה מחדש', generate: 'הקבוצות נוצרו ופורסמו', complete: 'המשחק הסתיים וננעל'}[action]);
      await refresh();
      qc.invalidateQueries({queryKey: ['admin-matches']});
      qc.invalidateQueries({queryKey: ['v25-home']});
    },
    onError: (e: any) => toast.error(e.message),
  });
  const move = async (target: string) => {
    if (!dragged) return;
    const before = calcBalance(q.data?.teams || []);
    const {error} = await supabase.rpc('move_team_player', {
      p_match_id: id,
      p_user_id: dragged,
      p_target_team_id: target,
    });
    if (error) toast.error(error.message);
    else {
      await refresh();
      toast.success(`השחקן הועבר. מדד האיזון לפני השינוי: ${before}%`);
    }
    setDragged(null);
  };
  const toggleLock = async (userId: string) => {
    const {data, error} = await supabase.rpc('toggle_team_player_lock', {
      p_match_id: id,
      p_user_id: userId,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(data ? 'השחקן ננעל' : 'נעילת השחקן בוטלה');
      refresh();
    }
  };
  const selectSwap = async (userId: string) => {
    if (!swapFirst) {
      setSwapFirst(userId);
      toast('בחר עכשיו שחקן מקבוצה אחרת');
      return;
    }
    if (swapFirst === userId) {
      setSwapFirst(null);
      return;
    }
    const {error} = await supabase.rpc('swap_team_players', {
      p_match_id: id,
      p_first_user: swapFirst,
      p_second_user: userId,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('השחקנים הוחלפו');
      refresh();
    }
    setSwapFirst(null);
  };
  const undo = async () => {
    const {error} = await supabase.rpc('undo_last_team_edit', {
      p_match_id: id,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('השינוי האחרון בוטל');
      refresh();
    }
  };
  const rerandom = async () => {
    if (!confirm('ליצור חלוקה חדשה? החלוקה הנוכחית תישאר בהיסטוריה.')) return;
    const {error} = await supabase.rpc('regenerate_balanced_teams', {
      p_match_id: id,
    });
    if (error) toast.error(error.message);
    else {
      toast.success('נוצרה חלוקה חדשה');
      refresh();
    }
  };
  const attendance = useMutation({
    mutationFn: async ({userId, attended}: {userId: string | null; attended: boolean}) => {
      const {error} = await supabase.rpc('set_match_attendance', {
        p_match_id: id,
        p_user_id: userId,
        p_attended: attended,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('הנוכחות עודכנה');
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const ratingsWindow = useMutation({
    mutationFn: async (open: boolean) => {
      const {error} = await supabase.rpc(open ? 'open_match_ratings' : 'close_match_ratings', {p_match_id: id});
      if (error) throw error;
      return open;
    },
    onSuccess: (open) => {
      toast.success(open ? 'הדירוג נפתח לשבעה ימים' : 'הדירוג נסגר');
      refresh();
      qc.invalidateQueries({queryKey: ['admin-matches']});
      qc.invalidateQueries({queryKey: ['open-ratings']});
    },
    onError: (e: any) => toast.error(e.message),
  });
  const shareTeams = async () => {
    if (!q.data?.teams.length) return;
    const m = q.data.match;
    const lines = [`⚽ ${m.title}`, `${new Date(`${m.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'})} | ${m.start_time.slice(0, 5)}`, m.location || '', '', ...q.data.teams.flatMap((t: any) => [`*${colorNames[t.color_key] || t.name}*`, ...t.team_players.map((p: any) => `• ${fullName(p.profiles)}`), '']), `⚖️ איזון: ${calcBalance(q.data.teams)}%`, `נשלח מ־TEAMUP`];
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({title: 'קבוצות TEAMUP', text});
      else {
        await navigator.clipboard.writeText(text);
        toast.success('הקבוצות הועתקו. אפשר להדביק בוואטסאפ');
      }
    } catch {}
  };
  if (q.isLoading) return <MatchSkeleton />;
  if (q.isError || !q.data)
    return (
      <Card className="empty-state">
        <h2>לא הצלחנו לפתוח את המשחק</h2>
        <p>{q.error instanceof Error ? q.error.message : 'פרטי המשחק לא נטענו. אפשר לנסות שוב.'}</p>
        <Button onClick={() => q.refetch()}>ניסיון נוסף</Button>
      </Card>
    );
  const {match, regs, teams} = q.data,
    confirmed = regs.filter((r) => r.registration_status === 'confirmed'),
    wait = regs.filter((r) => r.registration_status === 'waitlisted');
  const registeredIds = new Set([...confirmed, ...wait].map((r) => r.user_id));
  const availableMembers = (members.data || []).filter((member: any) => !registeredIds.has(member.user_id));
  const rosterIsEditable = canManageRegistrations && !match.ratings_open && ['registration_open', 'registration_closed'].includes(match.status);
  const isRegistered = mine?.response === 'attending' && ['confirmed', 'waitlisted'].includes(mine.registration_status);
  const isConfirmed = mine?.registration_status === 'confirmed';
  const isWaitlisted = mine?.registration_status === 'waitlisted';
  const capacityPercent = Math.min(100, (confirmed.length / Math.max(match.capacity, 1)) * 100);
  const spotsLeft = Math.max(0, match.capacity - confirmed.length);
  const matchStarted = Date.now() >= new Date(`${match.match_date}T${match.start_time}`).getTime();
  const matchEnded = Date.now() >= matchEndAt(match).getTime();
  const balance = calcBalance(teams),
    attendedCount = confirmed.filter((r) => r.attended).length,
    canManageAttendance = match.created_by === user?.id || canManage(g, 'open_ratings');
  const attendanceIsEditable = canManageAttendance && !match.ratings_open && !['completed', 'cancelled'].includes(match.status);
  const teamEditingIsOpen = match.status === 'teams_published' && !match.ratings_open && !matchStarted;
  const canEditPublishedTeams = canEditTeams && teamEditingIsOpen;
  const canRegenerateTeams = canGenerateTeams && teamEditingIsOpen;
  const canCompleteMatch = match.created_by === user?.id || canManageResults || canOpenRatings || isSystemAdmin(profile);
  const showLifecycleActions =
    (match.status === 'registration_open' && canCloseRegistration) ||
    (match.status === 'registration_closed' && (canCloseRegistration || canGenerateTeams)) ||
    (match.status === 'teams_published' && (canCompleteMatch || canCloseRegistration || canGenerateTeams)) ||
    (match.status === 'completed' && canOpenRatings);
  const flow = [
    ['הרשמה', confirmed.length > 0],
    ['סגירת הרשמה', ['registration_closed', 'teams_published', 'completed'].includes(match.status)],
    ['חלוקת קבוצות', teams.length > 0],
    ['סימון נוכחות', attendedCount > 0],
    ['דיווח שערים', Date.now() >= new Date(`${match.match_date}T${match.start_time}`).getTime() && attendedCount > 0],
    ['סיכום', match.status === 'completed'],
  ] as const;
  const shareSummary = async () => {
    const date = new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'});
    const {data: goals, error} = await supabase.from('goal_events').select('scorer_user_id,team_id,scorer:profiles!goal_events_scorer_user_id_fkey(first_name,last_name),team:teams(name,color_key)').eq('match_id', match.id).eq('status', 'approved');
    if (error) toast.error('לא הצלחנו לטעון את השערים לסיכום');
    const teamScores = new Map<string, {name: string;goals: number}>();
    teams.forEach((team: any) => teamScores.set(team.id, {name: colorNames[team.color_key] || team.name, goals: 0}));
    const scorers = new Map<string, {name: string;goals: number}>();
    (goals || []).forEach((goal: any) => {
      if (goal.team_id) {
        const team = teamScores.get(goal.team_id);
        if (team) team.goals += 1;
        else teamScores.set(goal.team_id, {name: colorNames[goal.team?.color_key] || goal.team?.name || 'קבוצה', goals: 1});
      }
      const scorer = scorers.get(goal.scorer_user_id);
      if (scorer) scorer.goals += 1;
      else scorers.set(goal.scorer_user_id, {name: fullName(goal.scorer as any), goals: 1});
    });
    const resultLine = teamScores.size ? `🏁 ${[...teamScores.values()].map((team) => `${team.name} ${team.goals}`).join(' · ')}` : '';
    const scorersLine = scorers.size ? `⚽ מבקיעים: ${[...scorers.values()].sort((a,b) => b.goals-a.goals).map((scorer) => `${scorer.name}${scorer.goals > 1 ? ` ×${scorer.goals}` : ''}`).join(' · ')}` : '';
    const lines = [`⚽ *${match.title}*`, `${date} | ${match.start_time.slice(0, 5)}`, match.location || '', resultLine, scorersLine, `👥 ${confirmed.length} רשומים · ${attendedCount} נכחו`, wait.length && match.status !== 'completed' ? `⏳ ${wait.length} ברשימת המתנה` : '', teams.length && match.status !== 'completed' ? `⚖️ איזון קבוצות: ${balance}%` : '', '', 'נשלח מ־TEAMUP'];
    const text = lines.filter(Boolean).join('\n');
    try {
      if (navigator.share) await navigator.share({title: 'סיכום משחק TEAMUP', text});
      else {
        await navigator.clipboard.writeText(text);
        toast.success('סיכום המשחק הועתק לוואטסאפ');
      }
    } catch {}
  };

  return (
    <div className="match-page-v2">
      <header className="match-page-header">
        <Link to="/matches" className="match-back-link"><ArrowRight size={17}/>כל המשחקים</Link>
        <div className="match-header-actions">
          <Button variant="secondary" onClick={shareSummary}><MessageCircle size={17}/>{match.status === 'completed' ? 'שיתוף סיכום המשחק' : 'שיתוף פרטי המשחק'}</Button>
          {teams.length > 0 && <Button onClick={shareTeams}><Users size={17}/>שיתוף קבוצות</Button>}
        </div>
      </header>
      <Card className="match-hero">
        <div className="match-hero-main">
          <div className="match-hero-copy">
            <Badge><span className="status-dot"/>{statusLabel(match.status)}</Badge>
            <h1>{match.title}</h1>
            <div className="match-detail-list">
              <span><CalendarDays size={18}/>{new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'})}</span>
              <span><Clock3 size={18}/>{match.start_time.slice(0, 5)}{match.end_time ? `–${match.end_time.slice(0, 5)}` : ''}</span>
              <span><MapPin size={18}/>{match.location || 'המיקום יעודכן בהמשך'}</span>
            </div>
            <div className="match-capacity-block">
              <div><span><Users size={17}/><strong>{confirmed.length}</strong> מתוך {match.capacity} שחקנים</span><small>{spotsLeft ? `${spotsLeft} מקומות פנויים` : wait.length ? `${wait.length} ממתינים` : 'הרשימה מלאה'}</small></div>
              <div className="match-capacity-meter"><i style={{width: `${capacityPercent}%`}}/></div>
            </div>
          </div>
          <aside className={`match-registration-panel ${isConfirmed ? 'is-confirmed' : isWaitlisted ? 'is-waitlisted' : ''}`}>
            <span className="registration-state-icon">{isConfirmed ? <CheckCircle2/> : isWaitlisted ? <Clock3/> : <Users/>}</span>
            <div>
              <small>ההרשמה שלך</small>
              <h2>{isConfirmed ? 'המקום שלך שמור' : isWaitlisted ? 'אתה ברשימת ההמתנה' : match.status === 'registration_open' ? 'מצטרפים למשחק?' : 'ההרשמה סגורה'}</h2>
              <p>{isConfirmed ? 'נתראה במגרש. אם התוכניות השתנו, אפשר לבטל כאן.' : isWaitlisted ? `אתה במקום ${Math.max(1, wait.findIndex((r) => r.user_id === user?.id) + 1)}. נעדכן אותך אם יתפנה מקום.` : match.status === 'registration_open' ? spotsLeft ? `נשארו ${spotsLeft} מקומות ברשימה הראשית.` : 'הרשימה מלאה, ההרשמה הבאה תיכנס להמתנה.' : 'לא ניתן להירשם או לבטל כרגע.'}</p>
            </div>
            {match.status === 'registration_open' && (isRegistered ? (
              <Button title="ביטול ההרשמה שלי למשחק" variant="secondary" onClick={() => confirm('לבטל את ההרשמה למשחק? אם יש רשימת המתנה, המקום יעבור לשחקן הבא.') && act.mutate('unavailable')} disabled={act.isPending}><UserX size={18}/>{act.isPending ? 'מעדכן...' : 'ביטול הרשמה'}</Button>
            ) : (
              <Button title="הרשמה למשחק" onClick={() => act.mutate('attending')} disabled={act.isPending}><Check size={18}/>{act.isPending ? 'נרשם...' : spotsLeft ? 'אני מגיע' : 'הצטרפות להמתנה'}</Button>
            ))}
          </aside>
        </div>
      </Card>
      <section className="match-command-center" aria-label="התקדמות המשחק">
        <div className="match-flow">
          {flow.map(([label, done], i) => (
            <div className={`flow-step ${done ? 'done' : ''}`} key={label}>
              <span>{done ? '✓' : i + 1}</span>
              <b>{label}</b>
            </div>
          ))}
        </div>
        {showLifecycleActions && <div className="match-lifecycle-actions">
          {match.status === 'registration_open' && canCloseRegistration && <Button variant="secondary" disabled={lifecycle.isPending} onClick={() => confirm('לסגור את ההרשמה? לאחר הסגירה ניתן ליצור את הקבוצות.') && lifecycle.mutate('close')}><Lock size={16}/>סגירת הרשמה</Button>}
          {match.status === 'registration_closed' && canCloseRegistration && <Button variant="secondary" disabled={lifecycle.isPending} onClick={() => lifecycle.mutate('open')}><LockOpen size={16}/>פתיחה מחדש</Button>}
          {match.status === 'registration_closed' && canGenerateTeams && <Button disabled={lifecycle.isPending} onClick={() => lifecycle.mutate('generate')}><Users size={16}/>יצירת קבוצות</Button>}
          {match.status === 'teams_published' && !matchStarted && (canCloseRegistration || canGenerateTeams) && <Button variant="secondary" disabled={lifecycle.isPending} onClick={() => confirm('לפתוח מחדש את ההרשמה ולבטל את חלוקת הקבוצות הנוכחית? כל השחקנים שכבר נרשמו יישארו ברשימה.') && lifecycle.mutate('reopenPublished')}><LockOpen size={16}/>ביטול חלוקה ופתיחה מחדש</Button>}
          {match.status === 'teams_published' && canCompleteMatch && <Button disabled={!matchEnded || lifecycle.isPending} title={matchEnded ? 'סיום המשחק ונעילת הנוכחות והקבוצות' : `ניתן לסיים לאחר ${matchEndAt(match).toLocaleTimeString('he-IL', {hour: '2-digit', minute: '2-digit'})}`} onClick={() => confirm('לסיים את המשחק? חלוקת הקבוצות והנוכחות יינעלו, ויש לטפל קודם בכל דיווחי השערים.') && lifecycle.mutate('complete')}><CheckCircle2 size={16}/>{matchEnded ? 'סיום משחק' : 'סיום לאחר שעת המשחק'}</Button>}
          {match.status === 'completed' && !match.ratings_open && canOpenRatings && <Button disabled={ratingsWindow.isPending} onClick={() => ratingsWindow.mutate(true)}><Star size={16}/>פתיחת דירוג</Button>}
          {match.ratings_open && canOpenRatings && <Button variant="secondary" disabled={ratingsWindow.isPending} onClick={() => confirm('לסגור את חלון הדירוג?') && ratingsWindow.mutate(false)}><Lock size={16}/>סגירת דירוג</Button>}
        </div>}
      </section>
      {canManageRegistrations && (
        <Card className="registration-manager-card">
          <div className="section-title">
            <div>
              <h2><UserPlus size={19} />ניהול רשימת המשחק</h2>
              <p className="section-help">הוספה ידנית מכבדת את הקיבולת; כשהרשימה מלאה השחקן ייכנס להמתנה.</p>
            </div>
            <Badge>למנהלים בלבד</Badge>
          </div>
          {rosterIsEditable ? (
            <div className="registration-manager-actions">
              <Select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value)} disabled={members.isLoading || manageRegistration.isPending} aria-label="בחירת שחקן להוספה">
                <option value="">{members.isLoading ? 'טוען שחקנים...' : availableMembers.length ? 'בחירת שחקן מהקבוצה' : 'כל שחקני הקבוצה כבר ברשימה'}</option>
                {availableMembers.map((member: any) => <option key={member.user_id} value={member.user_id}>{fullName(member.profiles)}</option>)}
              </Select>
              <Button disabled={!selectedPlayer || manageRegistration.isPending} onClick={() => manageRegistration.mutate({userId: selectedPlayer, attending: true})}>
                <UserPlus size={17} />הוספה לרשימה
              </Button>
            </div>
          ) : (
            <p className="empty-inline">לא ניתן לשנות את הרשימה לאחר פרסום הקבוצות או פתיחת הדירוג.</p>
          )}
        </Card>
      )}
      <section className="match-roster-grid">
        <Card className="match-roster-card">
          <div className="section-title">
            <div className="roster-heading"><span className="roster-heading-icon"><Users size={19}/></span><div><h2>{canManageAttendance || matchStarted ? 'משתתפים ונוכחות' : 'רשימת המשתתפים'}</h2><p>{canManageAttendance || matchStarted ? 'סימון הנוכחות קובע מי יוכל להשתתף בדירוג ובדיווחי השערים.' : 'השחקנים שמקומם במשחק אושר.'}</p></div></div>
            <Badge>{confirmed.length}/{match.capacity}</Badge>
          </div>
          {attendanceIsEditable && (
            <div className="roster-toolbar">
              {!match.ratings_open && confirmed.length > 0 && <Button variant="secondary" disabled={attendance.isPending} onClick={() => confirm('לסמן את כל הרשומים כנוכחים? לאחר מכן אפשר לבטל סימון למי שלא הגיע.') && attendance.mutate({userId: null, attended: true})}><Check size={17}/>סימון כולם כנוכחים</Button>}
            </div>
          )}
          <div className="players-grid">
            {confirmed.map((r, i) => (
              <div className="player-row" key={r.id} title={`נרשם במקום ${i + 1}`}>
                <div className="player-row-main"><b>{i + 1}</b><div className="player-avatar sm">{r.profiles?.first_name?.[0] || 'ש'}</div><span><strong>{fullName(r.profiles)}</strong><small>{positionLabel(r.profiles?.preferred_position)}</small></span></div>
                {(rosterIsEditable || attendanceIsEditable || matchStarted) && <div className="roster-row-actions">
                  {rosterIsEditable && <Button className="roster-remove-button" variant="danger" disabled={manageRegistration.isPending} title={`הסרת ${fullName(r.profiles)} מרשימת המשחק`} onClick={() => confirm(`להסיר את ${fullName(r.profiles)} מרשימת המשחק?`) && manageRegistration.mutate({userId: r.user_id, attending: false})}><Trash2 size={15}/>הסרה</Button>}
                  {attendanceIsEditable ? <Button className="roster-status-button" variant={r.attended ? 'secondary' : 'ghost'} disabled={attendance.isPending} onClick={() => attendance.mutate({userId: r.user_id, attended: !r.attended})}>{r.attended ? <><Check size={15}/>נכח</> : <><UserX size={15}/>לא סומן</>}</Button> : matchStarted && <Badge className={r.attended ? 'attendance-confirmed' : ''}>{r.attended ? 'נכח' : 'לא סומן'}</Badge>}
                </div>}
              </div>
            ))}
            {!confirmed.length && <div className="roster-empty"><Users size={25}/><div><strong>הרשימה עדיין ריקה</strong><span>היה הראשון שנרשם למשחק.</span></div></div>}
          </div>
        </Card>
        <Card className="match-waitlist-card">
          <div className="section-title">
            <div className="roster-heading"><span className="roster-heading-icon wait"><Clock3 size={19}/></span><div><h2>רשימת המתנה</h2><p>הסדר מתעדכן אוטומטית כשמתפנה מקום.</p></div></div>
            <Badge>{wait.length}</Badge>
          </div>
          <div className="waitlist-rows">
            {wait.map((r, i) => <div key={r.id} className="wait-row"><div className="wait-player"><b>{i + 1}</b><div className="player-avatar sm">{r.profiles?.first_name?.[0] || 'ש'}</div><span><strong>{fullName(r.profiles)}</strong><small>מקום {i + 1} בהמתנה</small></span></div>{rosterIsEditable && <div className="roster-row-actions"><Button className="roster-remove-button" variant="danger" disabled={manageRegistration.isPending} title={`הסרת ${fullName(r.profiles)} מרשימת ההמתנה`} onClick={() => confirm(`להסיר את ${fullName(r.profiles)} מרשימת ההמתנה?`) && manageRegistration.mutate({userId: r.user_id, attending: false})}><Trash2 size={15}/>הסרה</Button></div>}</div>)}
            {!wait.length && <div className="roster-empty compact"><CheckCircle2 size={23}/><div><strong>אין שחקנים בהמתנה</strong><span>כל מי שנרשם נמצא כרגע ברשימה הראשית.</span></div></div>}
          </div>
        </Card>
      </section>
      {teams.length > 0 && (
        <section className="teams-section">
          <div className="teams-heading">
            <div>
              <p>החלוקה פורסמה</p>
              <h2>הקבוצות למשחק</h2>
            </div>
            <Badge>
              <ShieldCheck size={15} />
              איזון {balance}%
            </Badge>
          </div>
          {(canEditPublishedTeams || canRegenerateTeams) && (
            <div className="team-editor-toolbar">
              {canEditPublishedTeams && (
                <>
                  <Button variant="secondary" onClick={undo} title="ביטול ההעברה או ההחלפה האחרונה">
                    <Undo2 size={17} />
                    Undo
                  </Button>
                  <Button variant="secondary" onClick={() => setSwapFirst(null)} title="בחר שחקן אחד ואז שחקן מקבוצה אחרת כדי להחליף ביניהם">
                    <Repeat2 size={17} />
                    {swapFirst ? 'בחר שחקן שני' : 'מצב החלפה'}
                  </Button>
                </>
              )}
              {canRegenerateTeams && (
                <Button variant="secondary" onClick={rerandom} title="יצירת חלוקה חדשה לפי הדירוגים והעמדות">
                  <RefreshCcw size={17} />
                  חלוקה מחדש
                </Button>
              )}
              <Button onClick={shareTeams} title="שיתוף רשימת הקבוצות דרך וואטסאפ או תפריט השיתוף">
                <MessageCircle size={17} />
                שיתוף
              </Button>
            </div>
          )}
          <div className="teams-board">
            {teams.map((team: any, i: number) => (
              <Card key={team.id} className={`team-card team-${team.color_key || ['red', 'blue', 'yellow', 'green'][i]}`} onDragOver={(e) => canEditPublishedTeams && e.preventDefault()} onDrop={() => canEditPublishedTeams && move(team.id)}>
                <header>
                  <div>
                    <span className="team-dot" />
                    <h3>{colorNames[team.color_key] || team.name}</h3>
                  </div>
                  <strong>{team.team_players.length} שחקנים</strong>
                </header>
                <div className="team-player-list">
                  {team.team_players.map((p: any) => (
                    <div key={p.id} className={`team-player ${swapFirst === p.user_id ? 'swap-selected' : ''} ${p.is_locked ? 'player-locked' : ''}`} draggable={canEditPublishedTeams && !p.is_locked} onDragStart={() => setDragged(p.user_id)} onClick={() => canEditPublishedTeams && selectSwap(p.user_id)} title={p.is_locked ? 'השחקן נעול ואי אפשר להעביר אותו' : canEditPublishedTeams ? 'לחיצה לבחירת השחקן להחלפה' : undefined}>
                      <GripVertical size={15} />
                      <div className="player-avatar sm">{p.profiles?.first_name?.[0] || 'ש'}</div>
                      <div>
                        <strong>{fullName(p.profiles)}</strong>
                        <span>{positionLabel(p.assigned_position || p.profiles?.preferred_position)}</span>
                      </div>
                      {canEditPublishedTeams ? (
                        <button
                          className="lock-player-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLock(p.user_id);
                          }}
                          title={p.is_locked ? 'פתיחת נעילת השחקן' : 'נעילת השחקן במקומו'}
                        >
                          {p.is_locked ? <Lock size={15} /> : <LockOpen size={15} />}
                        </button>
                      ) : (
                        <Star size={14} />
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
          {canEditPublishedTeams && <p className="drag-help">גרירה מעבירה שחקן. לחיצה על שני שחקנים מקבוצות שונות מחליפה ביניהם. מנעול מונע שינוי בטעות.</p>}
        </section>
      )}
      <GoalCenter match={match} registrations={regs} />
    </div>
  );
}

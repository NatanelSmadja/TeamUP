import {useEffect, useMemo, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {ArrowRight, CalendarDays, Check, CheckCircle2, Clock3, Eye, GripVertical, Lock, LockOpen, MapPin, MessageCircle, Pencil, RefreshCcw, Repeat2, Save, Share2, ShieldCheck, Star, Trash2, Undo2, UserPlus, UserX, Users, X} from 'lucide-react';
import {toast} from 'sonner';
import {Badge, Button, Card, Input, Select} from '../components/ui';
import {MatchSkeleton} from '../components/Skeletons';
import {useAuth} from '../contexts/AuthContext';
import {fullName, statusLabel, positionLabel} from '../lib/utils';
import {supabase} from '../lib/supabase';
import type {Match, MatchGuest, Registration} from '../types';
import {useRealtimeInvalidation} from '../hooks/useRealtime';
import {useGroup, canManage, isSystemAdmin} from '../hooks/useGroup';
import {GoalCenter} from '../components/GoalCenter';
import TeamReveal from '../components/TeamReveal';

const colorNames: any = {
  red: 'אדומים',
  blue: 'כחולים',
  yellow: 'צהובים',
  green: 'ירוקים',
};
const calcBalance = (teams: any[]) => {
  const ratings = teams.map((t) => {
    const vals = t.team_players.map((p: any) => Number(p.balance_rating_snapshot ?? p.guest?.balance_rating ?? p.profiles?.base_rating ?? 3));
    return vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0;
  });
  return ratings.length ? Math.max(0, Math.round(100 - (Math.max(...ratings) - Math.min(...ratings)) * 20)) : 0;
};
const participantName = (player: any) => player.guest?.display_name || fullName(player.profiles);
const participantPosition = (player: any) => player.assigned_position || player.guest?.preferred_position || player.profiles?.preferred_position;
const matchEndAt = (match: Match) => {
  const start = new Date(`${match.match_date}T${match.start_time}`);
  if (!match.end_time) return new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const end = new Date(`${match.match_date}T${match.end_time}`);
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  return end;
};

export default function MatchPage() {
  const {id} = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const {user, profile} = useAuth();
  const {data: g} = useGroup();
  const canEditTeams = canManage(g, 'edit_teams');
  const canEditMatch = canManage(g, 'edit_match') || isSystemAdmin(profile);
  const canGenerateTeams = canManage(g, 'generate_teams');
  const canCloseRegistration = canManage(g, 'close_registration');
  const canManageResults = canManage(g, 'enter_results');
  const canOpenRatings = canManage(g, 'open_ratings');
  const qc = useQueryClient();
  const [dragged, setDragged] = useState<string | null>(null);
  const [swapFirst, setSwapFirst] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPosition, setGuestPosition] = useState('utility');
  const [guestRating, setGuestRating] = useState('3');
  const [guestLinkUsers, setGuestLinkUsers] = useState<Record<string, string>>({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [matchTitle, setMatchTitle] = useState('');
  const [teamRevealOpen, setTeamRevealOpen] = useState(false);
  const openTeamReveal = () => {
    const next = new URLSearchParams(searchParams);
    next.set('reveal', 'teams');
    setSearchParams(next, {replace: true});
    setTeamRevealOpen(true);
  };
  const closeTeamReveal = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('reveal');
    setSearchParams(next, {replace: true});
    setTeamRevealOpen(false);
  };
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
          guests?: MatchGuest[];
          teams?: any[];
        } | null;
        if (details?.match) {
          const teams = details.teams || [];
          const latest = teams.length ? Math.max(...teams.map((x: any) => x.generation_version)) : 0;
          return {
            match: details.match,
            regs: details.regs || [],
            guests: details.guests || [],
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
      const [{data: regs, error: regsError}, {data: guests}, {data: teams, error: teamsError}] = await Promise.all([supabase.from('match_registrations').select('*,profiles!match_registrations_user_id_fkey(*)').eq('match_id', id).order('registered_at'), supabase.from('match_guests').select('*').eq('match_id', id).order('created_at'), supabase.from('teams').select('*,team_players(*,profiles(*),guest:match_guests!team_players_guest_id_fkey(*))').eq('match_id', id).eq('is_published', true).order('generation_version', {ascending: false}).order('team_number')]);
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
        guests: (guests || []) as MatchGuest[],
        teams: rows.filter((x: any) => x.generation_version === latest),
      };
    },
  });
  useEffect(() => {
    if (searchParams.get('reveal') === 'teams' && q.data?.teams.length) setTeamRevealOpen(true);
  }, [q.data?.teams.length, searchParams]);
  useRealtimeInvalidation(`match-${id}`, ['matches', 'match_registrations', 'match_guests', 'teams', 'team_players', 'player_ratings', 'team_edit_history', 'goal_events'], [key, ['v2-home']], !!id);
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
  const manageGuest = useMutation({
    mutationFn: async ({guestId = null, remove = false}: {guestId?: string | null;remove?: boolean}) => {
      const {data, error} = await supabase.rpc('manage_match_guest', {
        p_match_id: id,
        p_guest_id: guestId,
        p_display_name: remove ? null : guestName,
        p_position: guestPosition,
        p_balance_rating: Number(guestRating),
        p_remove: remove,
      });
      if (error) throw error;
      return data as {display_name?: string};
    },
    onSuccess: async (result, variables) => {
      if (!variables.remove) setGuestName('');
      await refresh();
      qc.invalidateQueries({queryKey: ['v2-home']});
      toast.success(variables.remove ? `${result?.display_name || 'האורח'} הוסר` : `${result?.display_name || guestName} נוסף כאורח חד־פעמי`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const linkGuest = useMutation({
    mutationFn: async ({guestId, userId}: {guestId: string;userId: string}) => {
      const {data, error} = await supabase.rpc('link_match_guest_to_user', {
        p_match_id: id,
        p_guest_id: guestId,
        p_user_id: userId,
      });
      if (error) throw error;
      return data as {guest_name?: string;player_name?: string};
    },
    onSuccess: async (result, variables) => {
      setGuestLinkUsers((current) => {
        const next = {...current};
        delete next[variables.guestId];
        return next;
      });
      await refresh();
      qc.invalidateQueries({queryKey: ['v2-home']});
      qc.invalidateQueries({queryKey: ['open-ratings']});
      toast.success(`${result?.guest_name || 'האורח'} הוחלף בהצלחה ב־${result?.player_name || 'השחקן הרשום'}`);
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
      if (action === 'generate') openTeamReveal();
      qc.invalidateQueries({queryKey: ['admin-matches']});
      qc.invalidateQueries({queryKey: ['v25-home']});
    },
    onError: (e: any) => toast.error(e.message),
  });
  const move = async (target: string) => {
    if (!dragged) return;
    const before = calcBalance(q.data?.teams || []);
    const {error} = await supabase.rpc('move_team_participant', {
      p_match_id: id,
      p_team_player_id: dragged,
      p_target_team_id: target,
    });
    if (error) toast.error(error.message);
    else {
      await refresh();
      toast.success(`השחקן הועבר. מדד האיזון לפני השינוי: ${before}%`);
    }
    setDragged(null);
  };
  const toggleLock = async (teamPlayerId: string) => {
    const {data, error} = await supabase.rpc('toggle_team_participant_lock', {
      p_match_id: id,
      p_team_player_id: teamPlayerId,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(data ? 'השחקן ננעל' : 'נעילת השחקן בוטלה');
      refresh();
    }
  };
  const selectSwap = async (teamPlayerId: string) => {
    if (!swapFirst) {
      setSwapFirst(teamPlayerId);
      toast('בחר עכשיו שחקן מקבוצה אחרת');
      return;
    }
    if (swapFirst === teamPlayerId) {
      setSwapFirst(null);
      return;
    }
    const {error} = await supabase.rpc('swap_team_participants', {
      p_match_id: id,
      p_first_player: swapFirst,
      p_second_player: teamPlayerId,
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
      await refresh();
      openTeamReveal();
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
  const guestAttendance = useMutation({
    mutationFn: async ({guestId, attended}: {guestId: string;attended: boolean}) => {
      const {error} = await supabase.rpc('set_match_guest_attendance', {p_match_id: id, p_guest_id: guestId, p_attended: attended});
      if (error) throw error;
    },
    onSuccess: () => { toast.success('נוכחות האורח עודכנה'); refresh(); },
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
  const renameMatch = useMutation({
    mutationFn: async () => {
      const title = matchTitle.trim().replace(/\s+/g, ' ');
      if (title.length < 2) throw new Error('שם המשחק חייב להכיל לפחות 2 תווים');
      if (title.length > 80) throw new Error('שם המשחק יכול להכיל עד 80 תווים');
      const {error} = await supabase.rpc('rename_match', {p_match_id: id, p_title: title});
      if (error) throw error;
      return title;
    },
    onSuccess: () => {
      toast.success('שם המשחק עודכן');
      setEditingTitle(false);
      qc.invalidateQueries({queryKey: key});
      qc.invalidateQueries({queryKey: ['admin-matches']});
      qc.invalidateQueries({queryKey: ['matches']});
      qc.invalidateQueries({queryKey: ['v2-home']});
    },
    onError: (e: any) => toast.error(e.message),
  });
  const shareTeams = async () => {
    if (!q.data?.teams.length) return;
    const m = q.data.match;
    const lines = [`⚽ ${m.title}`, `${new Date(`${m.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'})} | ${m.start_time.slice(0, 5)}`, m.location || '', '', ...q.data.teams.flatMap((t: any) => [`*${colorNames[t.color_key] || t.name}*`, ...t.team_players.map((p: any) => `• ${participantName(p)}${p.guest ? ' (אורח)' : ''}`), '']), `⚖️ איזון: ${calcBalance(q.data.teams)}%`, `נשלח מ־TEAMUP`];
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
    guests = q.data.guests || [],
    confirmed = regs.filter((r) => r.registration_status === 'confirmed'),
    wait = regs.filter((r) => r.registration_status === 'waitlisted');
  const registeredIds = new Set([...confirmed, ...wait].map((r) => r.user_id));
  const availableMembers = (members.data || []).filter((member: any) => !registeredIds.has(member.user_id));
  const confirmedIds = new Set(confirmed.map((registration) => registration.user_id));
  const guestLinkCandidates = (members.data || []).filter((member: any) => !confirmedIds.has(member.user_id));
  const rosterIsEditable = canManageRegistrations && !match.ratings_open && ['registration_open', 'registration_closed'].includes(match.status);
  const guestLinkIsEditable = canManageRegistrations && !match.ratings_open && ['registration_open', 'registration_closed', 'teams_published'].includes(match.status);
  const isRegistered = mine?.response === 'attending' && ['confirmed', 'waitlisted'].includes(mine.registration_status);
  const isConfirmed = mine?.registration_status === 'confirmed';
  const isWaitlisted = mine?.registration_status === 'waitlisted';
  const participantCount = confirmed.length + guests.length;
  const capacityPercent = Math.min(100, (participantCount / Math.max(match.capacity, 1)) * 100);
  const spotsLeft = Math.max(0, match.capacity - participantCount);
  const matchStarted = Date.now() >= new Date(`${match.match_date}T${match.start_time}`).getTime();
  const matchEnded = Date.now() >= matchEndAt(match).getTime();
  const balance = calcBalance(teams),
    attendedCount = confirmed.filter((r) => r.attended).length + guests.filter((guest) => guest.attended).length,
    canManageAttendance = match.created_by === user?.id || canManage(g, 'open_ratings');
  const shareTeamReveal = async () => {
    const url = new URL(`/matches/${match.id}`, window.location.origin);
    url.searchParams.set('group', match.group_id);
    url.searchParams.set('reveal', 'teams');
    const text = `⚽ הקבוצות של ${match.title} מוכנות!\nפותחים את הקישור ומגלים את ההרכבים אחד־אחד.`;
    try {
      if (navigator.share) await navigator.share({title: `חשיפת הקבוצות · ${match.title}`, text, url: url.toString()});
      else {
        await navigator.clipboard.writeText(`${text}\n${url.toString()}`);
        toast.success('הקישור לחשיפת הקבוצות הועתק');
      }
    } catch {}
  };
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
    ['הרשמה', participantCount > 0],
    ['סגירת הרשמה', ['registration_closed', 'teams_published', 'completed'].includes(match.status)],
    ['חלוקת קבוצות', teams.length > 0],
    ['סימון נוכחות', attendedCount > 0],
    ['דיווח שערים', Date.now() >= new Date(`${match.match_date}T${match.start_time}`).getTime() && attendedCount > 0],
    ['סיכום', match.status === 'completed'],
  ] as const;
  const shareSummary = async () => {
    const date = new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'});
    const {data: goals, error} = await supabase.from('goal_events').select('scorer_user_id,team_id,scorer:profiles!goal_events_scorer_user_id_fkey(first_name,last_name),team:teams(name,color_key)').eq('match_id', match.id).eq('status', 'approved');
    if (error) {
      toast.error('לא הצלחנו לטעון את השערים לסיכום');
      return;
    }
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
    const attendanceLine = `👥 נוכחות: ${attendedCount} מתוך ${participantCount}${guests.length ? ` · כולל ${guests.length} ${guests.length === 1 ? 'אורח' : 'אורחים'}` : ''}`;
    const completedLines: Array<string | null> = [
      `⚽ *${match.title}*`,
      `📅 ${date} · ${match.start_time.slice(0, 5)}`,
      match.location ? `📍 ${match.location}` : null,
      '',
      '*תוצאת המשחק*',
      ...([...teamScores.values()].map((team) => `• ${team.name}: ${team.goals}`)),
      '',
      '*כובשים*',
      ...(scorers.size
        ? [...scorers.values()].sort((a,b) => b.goals-a.goals || a.name.localeCompare(b.name, 'he')).map((scorer) => `• ${scorer.name} — ${scorer.goals === 1 ? 'שער אחד' : `${scorer.goals} שערים`}`)
        : ['• לא דווחו שערים']),
      '',
      attendanceLine,
      '',
      'נשלח מ־TEAMUP',
    ];
    const upcomingLines: Array<string | null> = [
      `⚽ *${match.title}*`,
      `📅 ${date} · ${match.start_time.slice(0, 5)}`,
      match.location ? `📍 ${match.location}` : null,
      '',
      `👥 ${participantCount} משתתפים${guests.length ? ` · ${guests.length} ${guests.length === 1 ? 'אורח' : 'אורחים'}` : ''}`,
      wait.length ? `⏳ ${wait.length} ברשימת המתנה` : null,
      teams.length ? `⚖️ איזון קבוצות: ${balance}%` : null,
      '',
      'נשלח מ־TEAMUP',
    ];
    const lines = match.status === 'completed' ? completedLines : upcomingLines;
    const text = lines.filter((line): line is string => line !== null).join('\n');
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
            {editingTitle ? <form className="match-title-editor" onSubmit={(event) => {event.preventDefault();renameMatch.mutate()}}>
              <Input autoFocus value={matchTitle} maxLength={80} onChange={(event) => setMatchTitle(event.target.value)} aria-label="שם המשחק"/>
              <Button type="submit" disabled={renameMatch.isPending || matchTitle.trim().length < 2}><Save size={17}/>{renameMatch.isPending ? 'שומר...' : 'שמירה'}</Button>
              <Button type="button" variant="ghost" disabled={renameMatch.isPending} onClick={() => {setEditingTitle(false);setMatchTitle(match.title)}}><X size={17}/>ביטול</Button>
            </form> : <div className="match-title-row">
              <h1>{match.title}</h1>
              {canEditMatch && <button type="button" className="match-title-edit" title="עריכת שם המשחק" aria-label="עריכת שם המשחק" onClick={() => {setMatchTitle(match.title);setEditingTitle(true)}}><Pencil size={17}/></button>}
            </div>}
            <div className="match-detail-list">
              <span><CalendarDays size={18}/>{new Date(`${match.match_date}T12:00:00`).toLocaleDateString('he-IL', {weekday: 'long', day: 'numeric', month: 'long'})}</span>
              <span><Clock3 size={18}/>{match.start_time.slice(0, 5)}{match.end_time ? `–${match.end_time.slice(0, 5)}` : ''}</span>
              <span><MapPin size={18}/>{match.location || 'המיקום יעודכן בהמשך'}</span>
            </div>
            <div className="match-capacity-block">
              <div><span><Users size={17}/><strong>{participantCount}</strong> מתוך {match.capacity} משתתפים</span><small>{spotsLeft ? `${spotsLeft} מקומות פנויים` : wait.length ? `${wait.length} ממתינים` : 'הרשימה מלאה'}</small></div>
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
            <div className="registration-manager-panels">
              <div className="registration-manager-actions">
                <Select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value)} disabled={members.isLoading || manageRegistration.isPending} aria-label="בחירת שחקן להוספה">
                  <option value="">{members.isLoading ? 'טוען שחקנים...' : availableMembers.length ? 'בחירת שחקן מהקבוצה' : 'כל שחקני הקבוצה כבר ברשימה'}</option>
                  {availableMembers.map((member: any) => <option key={member.user_id} value={member.user_id}>{fullName(member.profiles)}</option>)}
                </Select>
                <Button disabled={!selectedPlayer || manageRegistration.isPending} onClick={() => manageRegistration.mutate({userId: selectedPlayer, attending: true})}>
                  <UserPlus size={17} />הוספת חבר קבוצה
                </Button>
              </div>
              <div className="guest-manager">
                <div className="guest-manager-copy"><strong>שחקן אורח חד־פעמי</strong><span>נכנס לערבוב הקבוצות, אך לא לדירוג, MVP או סטטיסטיקות.</span></div>
                <div className="guest-manager-fields">
                  <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} maxLength={60} placeholder="שם האורח" aria-label="שם השחקן האורח" />
                  <Select value={guestPosition} onChange={(event) => setGuestPosition(event.target.value)} aria-label="עמדת האורח">
                    <option value="utility">עמדה: כללי</option><option value="goalkeeper">שוער</option><option value="defender">מגן</option><option value="midfielder">קשר</option><option value="winger">כנף</option><option value="striker">חלוץ</option>
                  </Select>
                  <Select value={guestRating} onChange={(event) => setGuestRating(event.target.value)} aria-label="רמת האורח לצורך איזון בלבד">
                    <option value="1">רמת איזון: מתחיל</option><option value="2">רמת איזון: בסיסי</option><option value="3">רמת איזון: ממוצע</option><option value="4">רמת איזון: טוב</option><option value="5">רמת איזון: מצוין</option>
                  </Select>
                  <Button disabled={guestName.trim().length < 2 || manageGuest.isPending || !spotsLeft} onClick={() => manageGuest.mutate({})}><UserPlus size={17}/>הוספת אורח</Button>
                </div>
              </div>
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
            <Badge>{participantCount}/{match.capacity}</Badge>
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
            {guests.map((guest, i) => (
              <div className="player-row guest-player-row" key={guest.id}>
                <div className="player-row-main"><b>{confirmed.length + i + 1}</b><div className="player-avatar sm">{guest.display_name[0]}</div><span><strong>{guest.display_name} <Badge className="guest-badge">אורח</Badge></strong><small>{positionLabel(guest.preferred_position)} · רמת איזון {guest.balance_rating}</small></span></div>
                {(rosterIsEditable || guestLinkIsEditable || attendanceIsEditable || matchStarted) && <div className="roster-row-actions">
                  {guestLinkIsEditable && <div className="guest-link-controls">
                    <Select value={guestLinkUsers[guest.id] || ''} onChange={(event) => setGuestLinkUsers((current) => ({...current, [guest.id]: event.target.value}))} disabled={members.isLoading || linkGuest.isPending} aria-label={`בחירת חשבון שיחליף את ${guest.display_name}`}>
                      <option value="">{members.isLoading ? 'טוען שחקנים...' : 'בחירת המשתמש שנרשם'}</option>
                      {guestLinkCandidates.map((member: any) => <option key={member.user_id} value={member.user_id}>{fullName(member.profiles)}</option>)}
                    </Select>
                    <Button variant="secondary" disabled={!guestLinkUsers[guest.id] || linkGuest.isPending} onClick={() => {
                      const selected = guestLinkCandidates.find((member: any) => member.user_id === guestLinkUsers[guest.id]);
                      const playerName = selected ? fullName(selected.profiles) : 'השחקן';
                      if (confirm(`להחליף את האורח ${guest.display_name} בחשבון של ${playerName}? המקום, הקבוצה והנוכחות יישמרו.`)) linkGuest.mutate({guestId: guest.id, userId: guestLinkUsers[guest.id]});
                    }}><RefreshCcw size={15}/>המרה לחשבון</Button>
                  </div>}
                  {rosterIsEditable && <Button className="roster-remove-button" variant="danger" disabled={manageGuest.isPending} onClick={() => confirm(`להסיר את ${guest.display_name} מרשימת המשחק?`) && manageGuest.mutate({guestId: guest.id, remove: true})}><Trash2 size={15}/>הסרה</Button>}
                  {attendanceIsEditable ? <Button className="roster-status-button" variant={guest.attended ? 'secondary' : 'ghost'} disabled={guestAttendance.isPending} onClick={() => guestAttendance.mutate({guestId: guest.id, attended: !guest.attended})}>{guest.attended ? <><Check size={15}/>נוכח</> : <><UserX size={15}/>לא הגיע</>}</Button> : matchStarted && <Badge className={guest.attended ? 'attendance-confirmed' : ''}>{guest.attended ? 'נוכח' : 'לא הגיע'}</Badge>}
                </div>}
              </div>
            ))}
            {!participantCount && <div className="roster-empty"><Users size={25}/><div><strong>הרשימה עדיין ריקה</strong><span>היה הראשון שנרשם למשחק.</span></div></div>}
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
            <div className="teams-heading-actions">
              <Badge><ShieldCheck size={15} />איזון {balance}%</Badge>
              <Button variant="secondary" onClick={shareTeamReveal}><Share2 size={16}/>שליחת קישור</Button>
              <Button onClick={openTeamReveal}><Eye size={16}/>חשיפת הקבוצות</Button>
            </div>
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
                    <div key={p.id} className={`team-player ${swapFirst === p.id ? 'swap-selected' : ''} ${p.is_locked ? 'player-locked' : ''} ${p.guest ? 'guest-team-player' : ''}`} draggable={canEditPublishedTeams && !p.is_locked} onDragStart={() => setDragged(p.id)} onClick={() => canEditPublishedTeams && selectSwap(p.id)} title={p.is_locked ? 'השחקן נעול ואי אפשר להעביר אותו' : canEditPublishedTeams ? 'לחיצה לבחירת השחקן להחלפה' : undefined}>
                      <GripVertical size={15} />
                      <div className="player-avatar sm">{p.guest?.display_name?.[0] || p.profiles?.first_name?.[0] || 'ש'}</div>
                      <div>
                        <strong>{participantName(p)} {p.guest && <Badge className="guest-badge">אורח</Badge>}</strong>
                        <span>{positionLabel(participantPosition(p))}</span>
                      </div>
                      {canEditPublishedTeams ? (
                        <button
                          className="lock-player-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLock(p.id);
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
      <TeamReveal match={match} teams={teams} balance={balance} open={teamRevealOpen} onClose={closeTeamReveal} onShare={shareTeamReveal}/>
    </div>
  );
}

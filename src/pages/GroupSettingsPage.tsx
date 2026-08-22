import {useEffect, useMemo, useState} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {Archive, Check, ChevronLeft, Clipboard, History, KeyRound, Palette, RefreshCw, Search, Settings, ShieldCheck, Trash2, UserPlus, UserRound, Users, X} from 'lucide-react';
import {toast} from 'sonner';
import {Badge, Button, Card, FieldHelp, Input, Select} from '../components/ui';
import {canManage, isGroupOwner, isSystemAdmin, useGroup} from '../hooks/useGroup';
import {useAuth} from '../contexts/AuthContext';
import {supabase} from '../lib/supabase';
import {fullName, positionLabel} from '../lib/utils';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

type JoinRequest = {
    request_id: string;
    user_id: string;
    first_name: string;
    last_name: string;
    preferred_position: string | null;
    preferred_positions: string[] | null;
    created_at: string;
};
const auditActionLabels: Record<string, string> = {
    'group.created': 'הקבוצה נוצרה',
    'group.updated': 'הגדרות הקבוצה עודכנו',
    'group.archived': 'הקבוצה הועברה לארכיון',
    'group.restored': 'הקבוצה שוחזרה',
    'member.archived': 'שחקן הועבר לארכיון',
    'member.restored': 'שחקן שוחזר לקבוצה',
    'member.removed': 'שחקן הוסר מהקבוצה',
    'match.registration_added': 'שחקן נוסף למשחק',
    'match.registration_removed': 'שחקן הוסר ממשחק',
    'match.guest_added': 'אורח נוסף למשחק',
    'match.guest_removed': 'אורח הוסר מהמשחק',
    'match.completed': 'משחק הושלם',
};
export default function GroupSettingsPage() {
    const {data: g} = useGroup();
    const {profile} = useAuth();
    const qc = useQueryClient();
    const [f, setF] = useState({
        name: '',
        description: '',
        default_location: '',
        visibility: 'public',
        join_mode: 'approval_required',
        theme_color: '#2563eb',
        poll_miss_tracking_enabled: false,
        poll_miss_alert_threshold: 2,
    });
    const [savedSettings, setSavedSettings] = useState('');
    const [memberSearch, setMemberSearch] = useState('');
    const [memberFilter, setMemberFilter] = useState<'active' | 'archived' | 'all'>('active');
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const owner = isGroupOwner(g);
    const canAdministerCurrentGroup = !!g && (g.member.role === 'admin' || isSystemAdmin(profile));
    const canManageMembers = canManage(g, 'manage_members');
    useEffect(() => {
        if (g) {
            const next = {
                name: g.group.name || '',
                description: g.group.description || '',
                default_location: g.group.default_location || '',
                visibility: g.group.visibility || 'public',
                join_mode: g.group.join_mode || 'approval_required',
                theme_color: g.group.theme_color || '#2563eb',
                poll_miss_tracking_enabled: g.group.poll_miss_tracking_enabled ?? false,
                poll_miss_alert_threshold: g.group.poll_miss_alert_threshold ?? 2,
            };
            setF(next);
            setSavedSettings(JSON.stringify(next));
        }
    }, [g?.group.id]);
    const hasUnsavedChanges = savedSettings !== '' && JSON.stringify(f) !== savedSettings;
    const requestsKey = ['join-requests', g?.group.id];
    const {
        data: requests = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: requestsKey,
        enabled: !!g && canManageMembers,
        queryFn: async () => {
            const {data, error} = await supabase.rpc('list_group_join_requests', {
                p_group_id: g!.group.id,
            });
            if (error) throw error;
            return (data || []) as JoinRequest[];
        },
    });
    const membersKey = ['settings-members', g?.group.id];
    const {
        data: members = [],
        isLoading: membersLoading,
        error: membersError,
    } = useQuery({
        queryKey: membersKey,
        enabled: !!g && canManageMembers,
        queryFn: async () => {
            const {data, error} = await supabase
                .from('group_members')
                .select('id,user_id,role,status,joined_at,profiles(first_name,last_name,preferred_position,preferred_positions,avatar_url)')
                .eq('group_id', g!.group.id)
                .order('joined_at');
            if (error) throw error;
            return data || [];
        },
    });
    const activeMembers = members.filter((member: any) => member.status === 'active');
    const archivedMembers = members.filter((member: any) => member.status !== 'active');
    const visibleMembers = useMemo(() => {
        const query = memberSearch.trim().toLocaleLowerCase('he');
        return members
            .filter((member: any) => memberFilter === 'all' || (memberFilter === 'active' ? member.status === 'active' : member.status !== 'active'))
            .filter((member: any) => !query || fullName(member.profiles as any).toLocaleLowerCase('he').includes(query))
            .sort((a: any, b: any) => Number(b.role === 'admin') - Number(a.role === 'admin') || Number(b.status === 'active') - Number(a.status === 'active') || fullName(a.profiles as any).localeCompare(fullName(b.profiles as any), 'he'));
    }, [members, memberFilter, memberSearch]);
    const selectedMember = members.find((member: any) => member.id === selectedMemberId) as any | undefined;
    const {data: audit = []} = useQuery({
        queryKey: ['group-audit', g?.group.id],
        enabled: !!g && canManageMembers,
        queryFn: async () => {
            const {data, error} = await supabase.from('audit_logs').select('*').eq('group_id', g!.group.id).order('created_at', {ascending: false}).limit(30);
            if (error) throw error;
            return data || [];
        },
    });
    useRealtimeInvalidation(`join-requests-${g?.group.id}`, ['group_join_requests'], [requestsKey], !!g && canManageMembers);
    useRealtimeInvalidation(`settings-members-${g?.group.id}`, ['group_members', 'profiles'], [membersKey], !!g && canManageMembers);
    const save = useMutation({
        mutationFn: async () => {
            const before = g!.group;
            const patch = {
                name: f.name.trim(),
                description: f.description.trim() || null,
                default_location: f.default_location.trim() || null,
                visibility: f.visibility,
                join_mode: f.join_mode,
                theme_color: f.theme_color,
                poll_miss_tracking_enabled: f.poll_miss_tracking_enabled,
                poll_miss_alert_threshold: Math.max(1, Math.min(20, Number(f.poll_miss_alert_threshold) || 2)),
                updated_at: new Date().toISOString(),
            };
            const {error} = await supabase.from('groups').update(patch).eq('id', g!.group.id);
            if (error) throw error;
            await supabase.rpc('log_group_audit', {
                p_group_id: g!.group.id,
                p_action: 'group.updated',
                p_entity_type: 'group',
                p_entity_id: g!.group.id,
                p_old: before,
                p_new: patch,
            });
        },
        onSuccess: () => {
            const normalized = {
                ...f,
                poll_miss_alert_threshold: Math.max(1, Math.min(20, Number(f.poll_miss_alert_threshold) || 2)),
            };
            setF(normalized);
            setSavedSettings(JSON.stringify(normalized));
            toast.success('הגדרות הקבוצה נשמרו');
            qc.invalidateQueries({queryKey: ['my-groups']});
            qc.invalidateQueries({queryKey: ['group-catalog']});
            qc.invalidateQueries({queryKey: ['group-audit']});
        },
        onError: (e: any) => toast.error(e.message),
    });
    const review = async (id: string, approve: boolean) => {
        const {error} = await supabase.rpc('review_group_join_request', {
            p_request_id: id,
            p_approve: approve,
        });
        if (error) toast.error(error.message);
        else {
            toast.success(approve ? 'השחקן צורף' : 'הבקשה נדחתה');
            await qc.invalidateQueries();
        }
    };
    const rotate = useMutation({
        mutationFn: async () => {
            const {data, error} = await supabase.rpc('rotate_group_invite_code', {
                p_group_id: g!.group.id,
            });
            if (error) throw error;
            return data as string;
        },
        onSuccess: (code) => {
            toast.success('קוד ההזמנה הוחלף');
            qc.invalidateQueries({queryKey: ['my-groups']});
            navigator.clipboard?.writeText(`${location.origin}/join/${code}`);
        },
        onError: (e: any) => toast.error(e.message),
    });
    const archive = useMutation({
        mutationFn: async () => {
            const {error} = await supabase.rpc('archive_group', {
                p_group_id: g!.group.id,
                p_restore: false,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('הקבוצה הועברה לארכיון');
            qc.invalidateQueries({queryKey: ['my-groups']});
            location.assign('/groups');
        },
        onError: (e: any) => toast.error(e.message),
    });
    const transfer = useMutation({
        mutationFn: async (userId: string) => {
            const {error} = await supabase.rpc('transfer_group_ownership', {
                p_group_id: g!.group.id,
                p_new_owner: userId,
            });
            if (error) throw error;
        },
        onSuccess: () => {
            toast.success('הבעלות הועברה');
            qc.invalidateQueries();
            location.reload();
        },
        onError: (e: any) => toast.error(e.message),
    });
    const updateMember = useMutation({
        mutationFn: async ({memberId, action}: {memberId: string; action: 'archive' | 'restore' | 'delete'}) => {
            const {error} =
                action === 'restore'
                    ? await supabase.rpc('restore_group_member', {
                          p_member_id: memberId,
                      })
                    : await supabase.rpc('remove_group_member', {
                          p_member_id: memberId,
                          p_permanent: action === 'delete',
                      });
            if (error) throw error;
            return action;
        },
        onSuccess: (action) => {
            setSelectedMemberId(null);
            toast.success(action === 'restore' ? 'השחקן הוחזר לקבוצה' : action === 'delete' ? 'השחקן הוסר מהקבוצה' : 'השחקן הועבר לארכיון');
            qc.invalidateQueries({queryKey: membersKey});
            qc.invalidateQueries({queryKey: ['admin-members', g?.group.id]});
            qc.invalidateQueries({queryKey: ['squad', g?.group.id]});
            qc.invalidateQueries({queryKey: ['my-groups']});
        },
        onError: (e: any) => toast.error(e.message),
    });
    useEffect(() => {
        if (!selectedMemberId) return;
        const close = (event: KeyboardEvent) => event.key === 'Escape' && setSelectedMemberId(null);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', close);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', close);
        };
    }, [selectedMemberId]);
    const inviteUrl = useMemo(() => (g?.group.invite_code ? `${location.origin}/join/${g.group.invite_code}` : ''), [g?.group.invite_code]);
    if (!canAdministerCurrentGroup && !canManageMembers) return <Card>אין לך הרשאת ניהול לקבוצה הזאת.</Card>;
    return (
        <div className="group-settings-page space-y-5">
            <div className="page-heading">
                <div>
                    <p>מועדון, הצטרפות, בעלות ובקרה</p>
                    <h1>הגדרות הקבוצה</h1>
                </div>
                <Settings />
            </div>
            <Card className="group-settings-overview">
                <div className="group-settings-club-mark" style={{background: `linear-gradient(135deg, ${f.theme_color}, #132a45)`}}>{f.name.slice(0, 2) || 'קב'}</div>
                <div className="group-settings-overview-copy"><span>ניהול מועדון</span><h2>{f.name || g?.group.name}</h2><p>{f.default_location || 'לא הוגדר מגרש קבוע'} · {f.visibility === 'public' ? 'קבוצה ציבורית' : 'קבוצה פרטית'}</p></div>
                <div className="group-settings-kpis">
                    <div><strong>{activeMembers.length}</strong><span>שחקנים פעילים</span></div>
                    <div><strong>{requests.length}</strong><span>בקשות ממתינות</span></div>
                    <div><strong>{archivedMembers.length}</strong><span>בארכיון</span></div>
                </div>
            </Card>
            <nav className="group-settings-nav" aria-label="ניווט בהגדרות הקבוצה">
                {canAdministerCurrentGroup && <a href="#club-settings">הגדרות מועדון</a>}
                {canManageMembers && <a href="#members-settings">שחקנים</a>}
                {owner && <a href="#invite-settings">הזמנה</a>}
                {canManageMembers && <a href="#audit-settings">פעילות</a>}
            </nav>
            {canAdministerCurrentGroup && (
                <>
                    <div className="group-settings-primary-grid" id="club-settings">
                    <Card className="form-card group-settings-section-card">
                        <div>
                            <h2>זהות ומדיניות המועדון</h2>
                            <p>הפרטים האלה שולטים באופן שבו משתמשים מגלים ומצטרפים לקבוצה.</p>
                        </div>
                        <div className="form-grid">
                            <div>
                                <FieldHelp title="שם הקבוצה">אפשר לשנות בלי לפגוע בהיסטוריה.</FieldHelp>
                                <Input
                                    value={f.name}
                                    onChange={(e) =>
                                        setF({
                                            ...f,
                                            name: e.target.value,
                                        })
                                    }
                                />
                            </div>
                            <div>
                                <FieldHelp title="מיקום קבוע">המגרש שבו משחקים בדרך כלל.</FieldHelp>
                                <Input value={f.default_location} onChange={(e) => setF({...f, default_location: e.target.value})} />
                            </div>
                            <div>
                                <FieldHelp title="נראות">קבוצה פרטית אינה מופיעה בגילוי.</FieldHelp>
                                <Select
                                    value={f.visibility}
                                    onChange={(e) =>
                                        setF({
                                            ...f,
                                            visibility: e.target.value,
                                        })
                                    }
                                >
                                    <option value="public">ציבורית</option>
                                    <option value="private">פרטית</option>
                                </Select>
                            </div>
                            <div>
                                <FieldHelp title="מדיניות הצטרפות">אפשר להצטרף מיד, באישור או רק בהזמנה.</FieldHelp>
                                <Select value={f.join_mode} onChange={(e) => setF({...f, join_mode: e.target.value})}>
                                    <option value="open">פתוחה</option>
                                    <option value="approval_required">באישור מנהל</option>
                                    <option value="invite_only">הזמנה בלבד</option>
                                </Select>
                            </div>
                            <div className="md:col-span-2">
                                <FieldHelp title="תיאור הקבוצה">מידע קצר לשחקנים.</FieldHelp>
                                <Input value={f.description} onChange={(e) => setF({...f, description: e.target.value})} />
                            </div>
                            <div>
                                <FieldHelp title="צבע המועדון">
                                    <Palette size={14} /> מוצג בכותרת ובכרטיסים.
                                </FieldHelp>
                                <Input type="color" value={f.theme_color} onChange={(e) => setF({...f, theme_color: e.target.value})} />
                            </div>
                        </div>
                    </Card>

                    <Card className="form-card group-settings-section-card">
                        <div className="space-y-2">
                            <h2 className="text-xl font-semibold">מעקב מענה לסקרים</h2>

                            <p className="text-sm leading-6 text-gray-600">כאשר המעקב פעיל, סגירת סקר מעדכנת לכל שחקן רצף של סקרים שלא נענו. היענות לסקר מאפסת את הרצף.</p>
                        </div>

                        <div className="form-grid">
                            <label className="flex cursor-pointer items-center justify-between gap-4   p-4">
                                <span className="font-medium">הפעלת מעקב והתראה למנהלים</span>
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 shrink-0 cursor-pointer accent-green-600"
                                    checked={f.poll_miss_tracking_enabled}
                                    onChange={(e) =>
                                        setF({
                                            ...f,
                                            poll_miss_tracking_enabled: e.target.checked,
                                        })
                                    }
                                />
                            </label>
                            <div className="space-y-2">
                                <FieldHelp title="התראה אחרי כמה סקרים שלא נענו">המנהל יקבל התראה ויחליט אם להסיר את השחקן. ניתן לבחור בין 1 ל־20.</FieldHelp>
                                <Input
                                    type="number"
                                    min={1}
                                    max={20}
                                    disabled={!f.poll_miss_tracking_enabled}
                                    value={f.poll_miss_alert_threshold}
                                    onChange={(e) =>
                                        setF({
                                            ...f,
                                            poll_miss_alert_threshold: Number(e.target.value),
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </Card>
                    </div>

                    <div className={`group-settings-save-bar ${hasUnsavedChanges ? 'is-dirty' : ''}`}>
                        <div>
                            <Check size={20} />
                            <span>{hasUnsavedChanges ? 'יש שינויים שעדיין לא נשמרו' : 'כל ההגדרות שמורות'}</span>
                        </div>
                        <Button disabled={!f.name.trim() || !hasUnsavedChanges || save.isPending} onClick={() => save.mutate()}>
                            <Check size={18} />
                            {save.isPending ? (
                                'שומר...'
                            ) : (
                                <>
                                    <span className="save-label-desktop">שמירת כל הגדרות הקבוצה</span>
                                    <span className="save-label-mobile">שמירה</span>
                                </>
                            )}
                        </Button>
                    </div>
                </>
            )}

            {owner && (
                <Card id="invite-settings" className="group-settings-section-card">
                    <div className="section-title">
                        <h2>
                            <KeyRound />
                            קישור הזמנה
                        </h2>
                        <Badge>לבעלים בלבד</Badge>
                    </div>
                    <p className="empty-inline">הקישור מצרף שחקנים ישירות לקבוצה. החלפת הקוד מבטלת מיד קישורים ישנים.</p>
                    <div className="action-row">
                        <Input readOnly value={inviteUrl} />
                        <Button
                            variant="secondary"
                            onClick={() => {
                                navigator.clipboard?.writeText(inviteUrl);
                                toast.success('הקישור הועתק');
                            }}
                        >
                            <Clipboard size={16} />
                            העתקה
                        </Button>
                        <Button variant="secondary" onClick={() => rotate.mutate()}>
                            <RefreshCw size={16} />
                            החלפת קוד
                        </Button>
                    </div>
                </Card>
            )}

            {canManageMembers && (
                <Card id="requests-settings" className="group-settings-section-card">
                    <div className="section-title">
                        <h2>
                            <UserPlus />
                            בקשות הצטרפות
                        </h2>
                        <Badge>{requests.length}</Badge>
                    </div>
                    {isLoading ? (
                        <p className="empty-inline">טוען בקשות...</p>
                    ) : error ? (
                        <p className="empty-inline">לא הצלחנו לטעון: {error instanceof Error ? error.message : 'שגיאה'}</p>
                    ) : (
                        <div className="join-request-list">
                            {requests.map((r) => (
                                <div key={r.request_id}>
                                    <div className="player-avatar">{r.first_name?.[0] || 'ש'}</div>
                                    <div>
                                        <strong>
                                            {fullName({
                                                first_name: r.first_name,
                                                last_name: r.last_name,
                                            } as any)}
                                        </strong>
                                        <span>{new Date(r.created_at).toLocaleDateString('he-IL')}</span>
                                    </div>
                                    <div>
                                        <Button onClick={() => review(r.request_id, true)}>
                                            <Check size={16} />
                                            אישור
                                        </Button>
                                        <Button variant="danger" onClick={() => review(r.request_id, false)}>
                                            <X size={16} />
                                            דחייה
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            {!requests.length && <p className="empty-inline">אין בקשות שממתינות לאישור.</p>}
                        </div>
                    )}
                </Card>
            )}
            {canManageMembers && (
                <Card id="members-settings" className="group-settings-section-card member-directory-card">
                    <div className="section-title member-directory-heading">
                        <div><h2><Users />ניהול שחקנים</h2><p>חיפוש מהיר ורשימה קומפקטית. לחיצה על שחקן פותחת את כל פעולות הניהול.</p></div>
                        <Badge>{activeMembers.length} פעילים</Badge>
                    </div>
                    {membersLoading ? (
                        <p className="empty-inline">טוען שחקנים...</p>
                    ) : membersError ? (
                        <p className="empty-inline">לא הצלחנו לטעון את השחקנים: {membersError instanceof Error ? membersError.message : 'שגיאה'}</p>
                    ) : (
                        <>
                        <div className="member-directory-toolbar">
                            <label className="member-search"><Search size={17}/><Input placeholder="חיפוש לפי שם..." value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} /></label>
                            <div className="member-filter-tabs" role="tablist" aria-label="סינון שחקנים">
                                <button className={memberFilter === 'active' ? 'active' : ''} onClick={() => setMemberFilter('active')}>פעילים <span>{activeMembers.length}</span></button>
                                <button className={memberFilter === 'archived' ? 'active' : ''} onClick={() => setMemberFilter('archived')}>ארכיון <span>{archivedMembers.length}</span></button>
                                <button className={memberFilter === 'all' ? 'active' : ''} onClick={() => setMemberFilter('all')}>הכול <span>{members.length}</span></button>
                            </div>
                        </div>
                        <div className="member-directory-list">
                            {visibleMembers.map((member: any) => {
                                const isAdmin = member.role === 'admin';
                                const isActive = member.status === 'active';
                                const name = fullName(member.profiles as any);
                                const positions = (member.profiles?.preferred_positions || [member.profiles?.preferred_position]).filter(Boolean).map(positionLabel).join(' · ');
                                return (
                                    <button key={member.id} className={`member-directory-row ${!isActive ? 'is-archived' : ''}`} onClick={() => setSelectedMemberId(member.id)}>
                                        <div className="player-avatar">{member.profiles?.first_name?.[0] || 'ש'}</div>
                                        <div className="member-directory-name"><strong>{name}</strong><span>{positions || 'ללא עמדה מוגדרת'}</span></div>
                                        <Badge className={isAdmin ? 'member-role-admin' : isActive ? 'member-role-active' : 'member-role-archived'}>{isAdmin ? 'מנהל' : isActive ? 'פעיל' : 'בארכיון'}</Badge>
                                        <span className="member-joined">הצטרף {new Date(member.joined_at).toLocaleDateString('he-IL')}</span>
                                        <ChevronLeft size={18}/>
                                    </button>
                                );
                            })}
                            {!visibleMembers.length && <div className="member-directory-empty"><UserRound size={28}/><strong>לא נמצאו שחקנים</strong><span>נסה לשנות את החיפוש או את הסינון.</span></div>}
                        </div>
                        </>
                    )}
                </Card>
            )}
            {owner && (
                <Card id="lifecycle-settings" className="group-settings-section-card">
                    <div className="section-title">
                        <h2>
                            <ShieldCheck />
                            בעלות ומחזור חיים
                        </h2>
                        <Badge>פעולות רגישות</Badge>
                    </div>
                    <div className="form-grid">
                        <div>
                            <FieldHelp title="העברת בעלות">הבעלים החדש חייב להיות חבר פעיל בקבוצה.</FieldHelp>
                            <Select defaultValue="" onChange={(e) => e.target.value && confirm('להעביר בעלות?') && transfer.mutate(e.target.value)}>
                                <option value="">בחר חבר...</option>
                                {activeMembers
                                    .filter((m: any) => m.user_id !== g?.member.user_id)
                                    .map((m: any) => (
                                        <option key={m.user_id} value={m.user_id}>
                                            {fullName(m.profiles as any)}
                                        </option>
                                    ))}
                            </Select>
                        </div>
                    </div>
                    <Button variant="danger" onClick={() => confirm('הקבוצה תועבר לארכיון ותוסתר מהחברים. להמשיך?') && archive.mutate()}>
                        <Archive size={16} />
                        ארכיון קבוצה
                    </Button>
                </Card>
            )}
            {canManageMembers && (
                <Card id="audit-settings" className="group-settings-section-card audit-card-compact">
                    <div className="section-title">
                        <h2>
                            <History />
                            יומן פעילות
                        </h2>
                        <Badge>{audit.length}</Badge>
                    </div>
                    <div className="audit-list">
                        {audit.map((a: any) => (
                            <div key={a.id}>
                                <strong>{auditActionLabels[a.action] || a.action}</strong>
                                <span>{new Date(a.created_at).toLocaleString('he-IL')}</span>
                                <small>{a.entity_type === 'match' ? 'משחק' : a.entity_type === 'member' ? 'שחקן' : a.entity_type === 'group' ? 'קבוצה' : a.entity_type}</small>
                            </div>
                        ))}
                        {!audit.length && <p className="empty-inline">עדיין אין פעולות מתועדות.</p>}
                    </div>
                </Card>
            )}
            {selectedMember && (() => {
                const name = fullName(selectedMember.profiles as any);
                const isActive = selectedMember.status === 'active';
                const isAdmin = selectedMember.role === 'admin';
                const positions = (selectedMember.profiles?.preferred_positions || [selectedMember.profiles?.preferred_position]).filter(Boolean).map(positionLabel).join(' · ');
                return <div className="member-modal-layer" role="dialog" aria-modal="true" aria-labelledby="member-modal-title" onMouseDown={(event) => event.target === event.currentTarget && setSelectedMemberId(null)}>
                    <Card className="member-management-modal">
                        <div className="section-title">
                            <div><h2 id="member-modal-title"><UserRound/>כרטיס שחקן</h2><p>פרטים ופעולות ניהול בקבוצה הנוכחית</p></div>
                            <Button variant="ghost" aria-label="סגירת כרטיס שחקן" onClick={() => setSelectedMemberId(null)}><X size={20}/></Button>
                        </div>
                        <div className="member-modal-hero">
                            <div className="member-modal-avatar">{selectedMember.profiles?.first_name?.[0] || 'ש'}</div>
                            <div><Badge className={isAdmin ? 'member-role-admin' : isActive ? 'member-role-active' : 'member-role-archived'}>{isAdmin ? 'מנהל קבוצה' : isActive ? 'שחקן פעיל' : 'בארכיון'}</Badge><h2>{name}</h2><p>{positions || 'לא הוגדרה עמדה מועדפת'}</p></div>
                        </div>
                        <div className="member-modal-details">
                            <div><span>סטטוס</span><strong>{isActive ? 'פעיל בקבוצה' : 'שחקן בארכיון'}</strong></div>
                            <div><span>תפקיד</span><strong>{isAdmin ? 'מנהל' : selectedMember.role === 'moderator' ? 'מנהל מוגבל' : 'שחקן'}</strong></div>
                            <div><span>תאריך הצטרפות</span><strong>{new Date(selectedMember.joined_at).toLocaleDateString('he-IL')}</strong></div>
                        </div>
                        {isAdmin ? <div className="member-modal-note"><ShieldCheck size={18}/><div><strong>חשבון ניהול מוגן</strong><span>לא ניתן להעביר מנהל לארכיון או להסיר אותו מהמסך הזה.</span></div></div> : <div className="member-modal-actions">
                            {isActive ? <>
                                <Button variant="secondary" disabled={updateMember.isPending} onClick={() => confirm(`להעביר את ${name} לארכיון?`) && updateMember.mutate({memberId: selectedMember.id, action: 'archive'})}><Archive size={17}/>העברה לארכיון</Button>
                                <Button variant="danger" disabled={updateMember.isPending} onClick={() => confirm(`להסיר את ${name} מהקבוצה לצמיתות? החשבון שלו וקבוצות אחרות לא ייפגעו.`) && updateMember.mutate({memberId: selectedMember.id, action: 'delete'})}><Trash2 size={17}/>הסרה מהקבוצה</Button>
                            </> : <Button disabled={updateMember.isPending} onClick={() => updateMember.mutate({memberId: selectedMember.id, action: 'restore'})}><UserPlus size={17}/>שחזור לקבוצה</Button>}
                        </div>}
                    </Card>
                </div>;
            })()}
        </div>
    );
}

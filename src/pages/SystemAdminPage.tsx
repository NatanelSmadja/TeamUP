import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  Database,
  Footprints,
  Goal,
  RefreshCw,
  Star,
  ShieldCheck,
  Trash2,
  Trophy,
  UserMinus,
  UserPlus,
  UserRoundSearch,
  UsersRound,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input, Select } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { isSystemAdmin } from "../hooks/useGroup";
import { toast } from "sonner";
import { footLabel, positionLabel } from "../lib/utils";

export default function SystemAdminPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [usersOpen, setUsersOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const allowed = isSystemAdmin(profile);
  const overview = useQuery({
    queryKey: ["system-overview"],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("system_admin_overview");
      if (error) throw error;
      return data as any;
    },
  });
  const groups = useQuery({
    queryKey: ["system-groups"],
    enabled: allowed && (groupsOpen || !!selectedUserId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("system_admin_groups", {
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      return data || [];
    },
  });
  const users = useQuery({
    queryKey: ["system-users"],
    enabled: allowed && usersOpen,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("system_admin_users", {
        p_limit: 200,
        p_offset: 0,
      });
      if (error) throw error;
      return data || [];
    },
  });
  const userDetail = useQuery({
    queryKey: ["system-user-detail", selectedUserId],
    enabled: allowed && !!selectedUserId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("system_admin_user_detail", {p_user_id: selectedUserId});
      if (error) throw error;
      return data as any;
    },
  });
  const archive = useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore: boolean }) => {
      const { error } = await supabase.rpc("archive_group", {
        p_group_id: id,
        p_restore: restore,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("סטטוס הקבוצה עודכן");
      qc.invalidateQueries({ queryKey: ["system-groups"] });
      qc.invalidateQueries({ queryKey: ["system-overview"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const manageUser = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "archive" | "restore" | "delete" }) => {
      const { error } = await supabase.rpc("system_admin_manage_user", {
        p_user_id: id,
        p_action: action,
      });
      if (error) throw error;
      return action;
    },
    onSuccess: (action) => {
      toast.success(action === "restore" ? "המשתמש שוחזר" : action === "delete" ? "המשתמש הוסר לצמיתות" : "המשתמש הועבר לארכיון");
      qc.invalidateQueries({ queryKey: ["system-users"] });
      qc.invalidateQueries({ queryKey: ["system-overview"] });
      qc.invalidateQueries({ queryKey: ["system-groups"] });
      qc.invalidateQueries({ queryKey: ["system-user-detail"] });
      if (action === "delete") setSelectedUserId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const assignUser = useMutation({
    mutationFn: async ({userId, groupId}: {userId: string; groupId: string}) => {
      const {error} = await supabase.rpc("system_admin_assign_user_to_group", {p_user_id: userId, p_group_id: groupId});
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("השחקן שויך לקבוצה");
      qc.invalidateQueries({queryKey: ["system-user-detail", selectedUserId]});
      qc.invalidateQueries({queryKey: ["system-users"]});
      qc.invalidateQueries({queryKey: ["system-groups"]});
      qc.invalidateQueries({queryKey: ["system-overview"]});
    },
    onError: (e: any) => toast.error(e.message),
  });
  const unassignUser = useMutation({
    mutationFn: async ({userId, groupId}: {userId: string; groupId: string}) => {
      const {error} = await supabase.rpc("system_admin_unassign_user_from_group", {p_user_id: userId, p_group_id: groupId});
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("השיוך לקבוצה הוסר");
      qc.invalidateQueries({queryKey: ["system-user-detail", selectedUserId]});
      qc.invalidateQueries({queryKey: ["system-users"]});
      qc.invalidateQueries({queryKey: ["system-groups"]});
      qc.invalidateQueries({queryKey: ["system-overview"]});
    },
    onError: (e: any) => toast.error(e.message),
  });
  if (!allowed)
    return (
      <Card className="empty-state">
        <ShieldCheck />
        <h2>אין הרשאת מערכת</h2>
        <p>המסך זמין רק למנהל המערכת הטכני.</p>
      </Card>
    );
  const s = overview.data || {};
  const visibleUsers = (users.data || []).filter((user: any) =>
    `${user.first_name || ""} ${user.last_name || ""}`.toLowerCase().includes(userSearch.trim().toLowerCase()),
  );
  const visibleGroups = (groups.data || []).filter((group: any) =>
    `${group.name || ""} ${group.owner_name || ""}`.toLowerCase().includes(groupSearch.trim().toLowerCase()),
  );
  return (
    <div className="space-y-5">
      <div className="page-heading">
        <div>
          <p>בקרה טכנית על הפלטפורמה</p>
          <h1>מערכת ניהול</h1>
        </div>
        <Database />
      </div>
      <div className="stats-grid">
        {[
          {label: "משתמשים", value: s.users, onOpen: () => setUsersOpen(true)},
          {label: "קבוצות פעילות", value: s.active_groups, onOpen: () => setGroupsOpen(true)},
          {label: "משחקים", value: s.matches},
          {label: "בקשות ממתינות", value: s.pending_requests},
        ].map(({label, value, onOpen}) => (
          <Card key={label} className={`stat-card ${onOpen ? "system-stat-clickable" : ""}`}
                role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
                onClick={onOpen}
                onKeyDown={onOpen ? (event) => (event.key === "Enter" || event.key === " ") && onOpen() : undefined}>
            <strong>{value ?? "—"}</strong>
            <span>{label}</span>
            {onOpen && <small>לחיצה לצפייה וניהול</small>}
          </Card>
        ))}
      </div>
      {usersOpen && <div className="system-users-modal-layer" role="dialog" aria-modal="true" aria-labelledby="system-users-title"
                         onMouseDown={(event) => event.target === event.currentTarget && setUsersOpen(false)}>
        <Card className="system-users-modal">
          <div className="section-title">
            <div><h2 id="system-users-title"><UserRoundSearch/>משתמשי המערכת</h2><p>{s.active_users ?? 0} פעילים · {s.archived_users ?? 0} בארכיון</p></div>
            <Button variant="ghost" aria-label="סגירת חלון" onClick={() => setUsersOpen(false)}><X size={20}/></Button>
          </div>
          <Input autoFocus placeholder="חיפוש לפי שם..." value={userSearch} onChange={(event) => setUserSearch(event.target.value)}/>
          <div className="system-users-list">
            {users.isLoading && <p className="empty-inline">טוען משתמשים...</p>}
            {users.error && <p className="empty-inline">לא הצלחנו לטעון משתמשים: {users.error instanceof Error ? users.error.message : "שגיאה"}</p>}
            {visibleUsers.map((user: any) => {
              const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "משתמש ללא שם";
              const archived = user.lifecycle_status === "archived";
              return <div className={`system-user-row system-user-clickable ${archived ? "is-archived" : ""}`} key={user.user_id}
                          role="button" tabIndex={0} onClick={() => setSelectedUserId(user.user_id)}
                          onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && setSelectedUserId(user.user_id)}>
                <div className="player-avatar">{user.first_name?.[0] || "ש"}</div>
                <div className="system-user-details">
                  <strong>{name}</strong>
                  <span>{user.is_system_admin ? "אדמין מערכת" : archived ? "בארכיון" : "משתמש פעיל"} · {user.group_count} קבוצות</span>
                </div>
                {!user.is_system_admin && <div className="action-row" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  {archived ? <Button disabled={manageUser.isPending} onClick={() => manageUser.mutate({id: user.user_id, action: "restore"})}>
                    <RefreshCw size={16}/>שחזור
                  </Button> : <Button variant="secondary" disabled={manageUser.isPending}
                                      onClick={() => confirm(`להעביר את ${name} לארכיון ולחסום את הכניסה שלו למערכת?`) && manageUser.mutate({id: user.user_id, action: "archive"})}>
                    <Archive size={16}/>ארכיון
                  </Button>}
                  <Button variant="danger" disabled={manageUser.isPending}
                          onClick={() => confirm(`להסיר את ${name} לצמיתות מהמערכת? לא ניתן לבטל פעולה זו.`) && manageUser.mutate({id: user.user_id, action: "delete"})}>
                    <Trash2 size={16}/>הסרה
                  </Button>
                </div>}
              </div>;
            })}
            {!users.isLoading && !users.error && !visibleUsers.length && <p className="empty-inline">לא נמצאו משתמשים.</p>}
          </div>
        </Card>
      </div>}
      {selectedUserId && <div className="system-users-modal-layer system-player-layer" role="dialog" aria-modal="true" aria-labelledby="system-player-title"
                              onMouseDown={(event) => event.target === event.currentTarget && setSelectedUserId(null)}>
        <Card className="system-users-modal system-player-modal">
          <div className="section-title">
            <div><h2 id="system-player-title"><UserRoundSearch/>כרטיס שחקן</h2><p>פרופיל, קבוצות וסטטיסטיקות מערכת</p></div>
            <Button variant="ghost" aria-label="סגירת כרטיס שחקן" onClick={() => setSelectedUserId(null)}><X size={20}/></Button>
          </div>
          {userDetail.isLoading && <p className="empty-inline">טוען את כרטיס השחקן...</p>}
          {userDetail.error && <p className="empty-inline">לא הצלחנו לטעון את הכרטיס: {userDetail.error instanceof Error ? userDetail.error.message : "שגיאה"}</p>}
          {userDetail.data && <SystemPlayerCard data={userDetail.data} allGroups={groups.data||[]} assigning={assignUser.isPending} unassigning={unassignUser.isPending}
                                                       onAssign={(groupId) => assignUser.mutate({userId:selectedUserId,groupId})}
                                                       onUnassign={(groupId) => unassignUser.mutate({userId:selectedUserId,groupId})}/>}
        </Card>
      </div>}
      {groupsOpen && <div className="system-users-modal-layer" role="dialog" aria-modal="true" aria-labelledby="system-groups-title"
                          onMouseDown={(event) => event.target === event.currentTarget && setGroupsOpen(false)}>
        <Card className="system-users-modal">
          <div className="section-title">
            <div><h2 id="system-groups-title"><UsersRound/>קבוצות בפלטפורמה</h2><p>{s.active_groups ?? 0} פעילות · {s.archived_groups ?? 0} בארכיון</p></div>
            <Button variant="ghost" aria-label="סגירת חלון" onClick={() => setGroupsOpen(false)}><X size={20}/></Button>
          </div>
          <Input autoFocus placeholder="חיפוש לפי שם קבוצה או בעלים..." value={groupSearch}
                 onChange={(event) => setGroupSearch(event.target.value)}/>
          <div className="system-users-list">
            {groups.isLoading && <p className="empty-inline">טוען קבוצות...</p>}
            {groups.error && <p className="empty-inline">לא הצלחנו לטעון קבוצות: {groups.error instanceof Error ? groups.error.message : "שגיאה"}</p>}
            {visibleGroups.map((group: any) => {
              const active = group.lifecycle_status === "active";
              const status = active ? "פעילה" : group.lifecycle_status === "archived" ? "בארכיון" : group.lifecycle_status;
              return <div className={`system-user-row system-group-row ${!active ? "is-archived" : ""}`} key={group.group_id}>
                <div className="system-group-icon">{group.name?.slice(0, 2) || "קב"}</div>
                <div className="system-user-details">
                  <div className="system-group-name"><strong>{group.name}</strong><Badge>{status}</Badge></div>
                  <span>בעלים: {group.owner_name || "לא הוגדר"} · {group.member_count} חברים · {group.visibility === "public" ? "ציבורית" : "פרטית"}</span>
                </div>
                <div className="action-row">
                  <Button variant="secondary" disabled={archive.isPending}
                          onClick={() => confirm(active ? `להעביר את ${group.name} לארכיון?` : `לשחזר את ${group.name}?`) && archive.mutate({id: group.group_id, restore: !active})}>
                    {active ? <><Archive size={16}/>ארכיון</> : <><RefreshCw size={16}/>שחזור</>}
                  </Button>
                </div>
              </div>;
            })}
            {!groups.isLoading && !groups.error && !visibleGroups.length && <p className="empty-inline">לא נמצאו קבוצות.</p>}
          </div>
        </Card>
      </div>}
    </div>
  );
}

function SystemPlayerCard({data,allGroups,assigning,unassigning,onAssign,onUnassign}:{data:any;allGroups:any[];assigning:boolean;unassigning:boolean;onAssign:(groupId:string)=>void;onUnassign:(groupId:string)=>void}) {
  const [selectedGroup,setSelectedGroup]=useState('');
  const p=data.profile||{};const s=data.summary||{};const groups=data.groups||[];
  const name=`${p.first_name||""} ${p.last_name||""}`.trim()||"משתמש ללא שם";
  const positions=(p.preferred_positions?.length?p.preferred_positions:[p.preferred_position,p.secondary_position]).filter(Boolean).map(positionLabel);
  const activeMemberships=new Set(groups.filter((group:any)=>group.membership_status==='active').map((group:any)=>group.group_id));
  const availableGroups=allGroups.filter((group:any)=>group.lifecycle_status==='active'&&!activeMemberships.has(group.group_id));
  const selected=availableGroups.some((group:any)=>group.group_id===selectedGroup)?selectedGroup:availableGroups[0]?.group_id||'';
  return <div className="system-player-card">
    <section className="system-player-hero">
      {p.avatar_url?<img src={p.avatar_url} alt="" className="system-player-avatar"/>:<div className="system-player-avatar">{p.first_name?.[0]||"ש"}</div>}
      <div><div className="system-group-name"><h2>{name}</h2><Badge>{p.lifecycle_status==='archived'?'בארכיון':p.is_system_admin?'אדמין מערכת':'פעיל'}</Badge></div><p>{positions.join(' · ')||'ללא עמדה'} · רגל {footLabel(p.preferred_foot)}</p><small>{p.birth_date?`תאריך לידה ${new Date(`${p.birth_date}T12:00:00`).toLocaleDateString('he-IL')} · `:''}הצטרף למערכת ב־{new Date(p.created_at).toLocaleDateString('he-IL')}</small></div>
    </section>
    <div className="system-player-stats">
      <Card><Goal/><strong>{Number(s.goals||0)}</strong><span>שערים</span></Card>
      <Card><Star/><strong>{Number(s.avg_rating||p.base_rating||3).toFixed(2)}</strong><span>דירוג</span></Card>
      <Card><Trophy/><strong>{Number(s.mvp||0)}</strong><span>MVP</span></Card>
      <Card><Footprints/><strong>{Number(s.games||0)}</strong><span>משחקים</span></Card>
    </div>
    <section className="system-player-groups">
      <div className="section-title"><h3><UsersRound size={19}/>קבוצות של השחקן</h3><Badge>{Number(s.groups||0)} פעילות</Badge></div>
      {p.lifecycle_status==='active'&&<div className="system-player-assign"><div><strong><UserPlus size={17}/>שיוך לקבוצה</strong><p>בחר קבוצה פעילה. חברות קודמת שאינה פעילה תשוחזר.</p></div>{availableGroups.length?<div className="system-player-assign-actions"><Select value={selected} onChange={(event)=>setSelectedGroup(event.target.value)}>{availableGroups.map((group:any)=><option key={group.group_id} value={group.group_id}>{group.name}</option>)}</Select><Button disabled={!selected||assigning} onClick={()=>confirm(`לשייך את ${name} לקבוצה ${availableGroups.find((group:any)=>group.group_id===selected)?.name}?`)&&onAssign(selected)}><UserPlus size={16}/>{assigning?'משייך...':'שיוך'}</Button></div>:<Badge>משויך לכל הקבוצות הפעילות</Badge>}</div>}
      {groups.map((group:any)=><div className={`system-player-group ${group.membership_status!=='active'||group.group_status!=='active'?'is-archived':''}`} key={group.group_id}>
        <div className="system-group-icon">{group.name?.slice(0,2)||'קב'}</div>
        <div className="system-user-details"><div className="system-group-name"><strong>{group.name}</strong>{group.is_owner&&<Badge>בעלים</Badge>}</div><span>{group.role==='admin'||group.role==='moderator'?'מנהל קבוצה':'שחקן'} · {group.membership_status==='active'?'חבר פעיל':'חברות לא פעילה'}{group.group_status!=='active'?' · הקבוצה בארכיון':''}</span><small><CalendarDays size={13}/> הצטרף {new Date(group.joined_at).toLocaleDateString('he-IL')}</small></div>
        <div className="system-player-group-actions"><div className="system-player-group-stats"><span><Goal size={14}/>{group.goals||0}</span><span><Star size={14}/>{Number(group.avg_rating||3).toFixed(2)}</span><span><Footprints size={14}/>{group.games||0}</span></div>{group.membership_status==='active'&&!group.is_owner&&<Button variant="danger" disabled={unassigning} onClick={()=>confirm(`להסיר את השיוך של ${name} מהקבוצה ${group.name}?`)&&onUnassign(group.group_id)}><UserMinus size={15}/>הסרת שיוך</Button>}</div>
      </div>)}
      {!groups.length&&<p className="empty-inline">השחקן אינו משויך לאף קבוצה.</p>}
    </section>
  </div>;
}

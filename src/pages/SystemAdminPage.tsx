import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Database,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundSearch,
  UsersRound,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { isSystemAdmin } from "../hooks/useGroup";
import { toast } from "sonner";

export default function SystemAdminPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [usersOpen, setUsersOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
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
    queryKey: ["system-groups", page],
    enabled: allowed,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("system_admin_groups", {
        p_limit: 20,
        p_offset: page * 20,
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
          {label: "משתמשים", value: s.users, clickable: true},
          {label: "קבוצות פעילות", value: s.active_groups},
          {label: "משחקים", value: s.matches},
          {label: "בקשות ממתינות", value: s.pending_requests},
        ].map(({label, value, clickable}) => (
          <Card key={label} className={`stat-card ${clickable ? "system-stat-clickable" : ""}`}
                role={clickable ? "button" : undefined} tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => setUsersOpen(true) : undefined}
                onKeyDown={clickable ? (event) => (event.key === "Enter" || event.key === " ") && setUsersOpen(true) : undefined}>
            <strong>{value ?? "—"}</strong>
            <span>{label}</span>
            {clickable && <small>לחיצה לצפייה וניהול</small>}
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
              return <div className={`system-user-row ${archived ? "is-archived" : ""}`} key={user.user_id}>
                <div className="player-avatar">{user.first_name?.[0] || "ש"}</div>
                <div className="system-user-details">
                  <strong>{name}</strong>
                  <span>{user.is_system_admin ? "אדמין מערכת" : archived ? "בארכיון" : "משתמש פעיל"} · {user.group_count} קבוצות</span>
                </div>
                {!user.is_system_admin && <div className="action-row">
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
      <Card>
        <div className="section-title">
          <h2>
            <UsersRound />
            קבוצות בפלטפורמה
          </h2>
          <Badge>{s.groups ?? 0}</Badge>
        </div>
        <div className="admin-match-list">
          {(groups.data || []).map((group: any) => (
            <div className="admin-match-row" key={group.group_id}>
              <div>
                <Badge>
                  {group.lifecycle_status === "active"
                    ? "פעילה"
                    : group.lifecycle_status === "archived"
                      ? "בארכיון"
                      : group.lifecycle_status}
                </Badge>
                <h2>{group.name}</h2>
                <p>
                  {group.owner_name} · {group.member_count} חברים ·{" "}
                  {group.visibility === "public" ? "ציבורית" : "פרטית"}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  archive.mutate({
                    id: group.group_id,
                    restore: group.lifecycle_status !== "active",
                  })
                }
              >
                {group.lifecycle_status === "active" ? (
                  <>
                    <Archive size={16} />
                    ארכיון
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    שחזור
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
        <div className="action-row mt-4">
          <Button
            variant="secondary"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            הקודם
          </Button>
          <Button
            variant="secondary"
            disabled={(groups.data || []).length < 20}
            onClick={() => setPage((p) => p + 1)}
          >
            הבא
          </Button>
        </div>
      </Card>
    </div>
  );
}

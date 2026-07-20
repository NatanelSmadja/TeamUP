import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Database,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { Badge, Button, Card } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { isSystemAdmin } from "../hooks/useGroup";
import { toast } from "sonner";

export default function SystemAdminPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
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
  if (!allowed)
    return (
      <Card className="empty-state">
        <ShieldCheck />
        <h2>אין הרשאת מערכת</h2>
        <p>המסך זמין רק למנהל המערכת הטכני.</p>
      </Card>
    );
  const s = overview.data || {};
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
          ["משתמשים", s.users],
          ["קבוצות פעילות", s.active_groups],
          ["משחקים", s.matches],
          ["בקשות ממתינות", s.pending_requests],
        ].map(([label, value]) => (
          <Card key={String(label)} className="stat-card">
            <strong>{value ?? "—"}</strong>
            <span>{label}</span>
          </Card>
        ))}
      </div>
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

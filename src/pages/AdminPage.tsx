import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  CalendarCheck,
  Copy,
  Edit3,
  Lock,
  Plus,
  Shuffle,
  Trash2,
  Unlock,
  Users,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  FieldHelp,
  Input,
  Tooltip,
} from "../components/ui";
import { useGroup, canManage } from "../hooks/useGroup";
import { supabase } from "../lib/supabase";
import { statusLabel, fullName } from "../lib/utils";
import type { Match } from "../types";
import { useAuth } from "../contexts/AuthContext";
import { useRealtimeInvalidation } from "../hooks/useRealtime";

const dayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const nextWeekday = (day: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  let add = (day - d.getDay() + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
};
const sundayOfWeek = (offset = 0) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() + offset * 7);
  return d.toISOString().slice(0, 10);
};
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
const perms = [
  ["create_match", "פתיחת משחקים"],
  ["close_registration", "סגירה ופתיחה של הרשמה"],
  ["generate_teams", "ערבוב קבוצות"],
  ["open_ratings", "פתיחת דירוגים"],
  ["manage_members", "ניהול שחקנים"],
];

type Tab = "matches" | "polls" | "members";
export default function AdminPage() {
  const { data: g } = useGroup();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("matches");
  const [open, setOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(2);
  const [f, setF] = useState({
    title: "משחק TEAMUP",
    match_date: nextWeekday(2),
    start_time: "21:00",
    end_time: "22:30",
    location: "Gol Time",
    capacity: "15",
    team_count: "3",
    team_size: "5",
    price_per_player: "0",
  });
  const [pollForm, setPollForm] = useState({
    title: "סקר זמינות למשחק",
    week_start: sundayOfWeek(0),
    description: "",
  });
  const allowed = canManage(g);
  const isMainAdmin = g?.member.role === "admin";
  const { data: matches = [] } = useQuery({
    queryKey: ["admin-matches", g?.group.id],
    enabled: !!g && allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("group_id", g!.group.id)
        .order("match_date", { ascending: false })
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data as Match[];
    },
  });
  const { data: polls = [] } = useQuery({
    queryKey: ["admin-polls", g?.group.id],
    enabled: !!g && allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weekly_polls")
        .select("*,availability_votes(count),weekly_poll_responses(count)")
        .eq("group_id", g!.group.id)
        .order("week_start", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const { data: members = [] } = useQuery({
    queryKey: ["admin-members", g?.group.id],
    enabled: !!g && allowed,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_members")
        .select("*,profiles(*),member_permissions(permission_key)")
        .eq("group_id", g!.group.id)
        .order("joined_at");
      if (error) throw error;
      return data as any[];
    },
  });
  useRealtimeInvalidation(
    `admin-${g?.group.id}`,
    [
      "matches",
      "match_registrations",
      "group_members",
      "member_permissions",
      "weekly_polls",
      "availability_votes",
      "weekly_poll_responses",
    ],
    [
      ["admin-matches", g?.group.id],
      ["admin-members", g?.group.id],
      ["admin-polls", g?.group.id],
    ],
    !!g && allowed,
  );
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("matches")
        .insert({
          ...f,
          capacity: +f.capacity,
          team_count: +f.team_count,
          team_size: +f.team_size,
          price_per_player: +f.price_per_player,
          group_id: g!.group.id,
          created_by: g!.member.user_id,
          status: "registration_open",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ההרשמה נפתחה");
      setOpen(false);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const createPoll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("weekly_polls")
        .insert({
          group_id: g!.group.id,
          created_by: g!.member.user_id,
          title: pollForm.title.trim() || "סקר זמינות",
          description: pollForm.description.trim() || null,
          week_start: pollForm.week_start,
          status: "open",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (row) => {
      toast.success("הסקר נפתח");
      setPollOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-polls", g?.group.id] });
      window.location.assign(`/availability?poll=${row.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const rpc = async (name: string, args: any, success: string) => {
    const { error } = await supabase.rpc(name, args);
    if (error) toast.error(error.message);
    else {
      toast.success(success);
      qc.invalidateQueries();
    }
  };
  const updatePoll = async (id: string, patch: any, success: string) => {
    const { error } = await supabase
      .from("weekly_polls")
      .update(patch)
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(success);
      qc.invalidateQueries({ queryKey: ["admin-polls", g?.group.id] });
    }
  };
  const editPoll = async (p: any) => {
    const title = prompt("שם הסקר", p.title || "סקר זמינות");
    if (title === null) return;
    const week = prompt("תאריך תחילת השבוע בפורמט YYYY-MM-DD", p.week_start);
    if (week === null) return;
    await updatePoll(
      p.id,
      { title: title.trim() || "סקר זמינות", week_start: week },
      "הסקר עודכן",
    );
  };
  const deletePoll = async (p: any) => {
    if (!confirm(`למחוק את “${p.title || "הסקר"}” ואת כל ההצבעות שלו?`)) return;
    const { error } = await supabase
      .from("weekly_polls")
      .delete()
      .eq("id", p.id);
    if (error) toast.error(error.message);
    else {
      toast.success("הסקר נמחק");
      qc.invalidateQueries({ queryKey: ["admin-polls", g?.group.id] });
    }
  };
  const duplicatePoll = async (p: any) => {
    const { data, error } = await supabase.rpc("duplicate_weekly_poll", {
      p_poll_id: p.id,
      p_week_start: null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("הסקר שוכפל לשבוע הבא");
      qc.invalidateQueries({ queryKey: ["admin-polls", g?.group.id] });
      return data;
    }
  };
  const togglePerm = async (m: any, key: string, on: boolean) => {
    if (on) {
      const { error } = await supabase
        .from("member_permissions")
        .upsert(
          {
            group_member_id: m.id,
            permission_key: key,
            granted_by: g!.member.user_id,
          },
          {
            onConflict: "group_member_id,permission_key",
            ignoreDuplicates: true,
          },
        );
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase
        .from("member_permissions")
        .delete()
        .eq("group_member_id", m.id)
        .eq("permission_key", key);
      if (error) return toast.error(error.message);
    }
    toast.success("ההרשאות עודכנו");
    qc.invalidateQueries({ queryKey: ["admin-members"] });
  };
  if (!allowed) return <Card>אין לך הרשאת ניהול.</Card>;
  return (
    <div className="space-y-5">
      <div className="page-heading">
        <div>
          <p>שליטה במשחקים, סקרים, הרשאות וחברי הקבוצה</p>
          <h1>מרכז ניהול</h1>
        </div>
        <div className="segmented">
          <button
            className={tab === "matches" ? "active" : ""}
            onClick={() => setTab("matches")}
          >
            משחקים
          </button>
          <button
            className={tab === "polls" ? "active" : ""}
            onClick={() => setTab("polls")}
          >
            סקרים
          </button>
          {isMainAdmin && (
            <button
              className={tab === "members" ? "active" : ""}
              onClick={() => setTab("members")}
            >
              שחקנים
            </button>
          )}
        </div>
      </div>
      {tab === "matches" && (
        <>
          <Button onClick={() => setOpen(!open)} title="פתיחת טופס ליצירת משחק">
            <Plus size={18} />
            משחק חדש
          </Button>
          {open && (
            <Card className="form-card">
              <div>
                <h2>פתיחת הרשמה חדשה</h2>
                <p>
                  אפשר לפתוח כמה משחקים באותו שבוע. כל משחק נשמר ומופיע בנפרד.
                </p>
              </div>
              <div className="form-grid">
                <div>
                  <FieldHelp title="שם המשחק">
                    כותרת ייחודית תעזור להבדיל בין משחקים באותו שבוע.
                  </FieldHelp>
                  <Input
                    value={f.title}
                    onChange={(e) => setF({ ...f, title: e.target.value })}
                  />
                </div>
                <div>
                  <FieldHelp title="מיקום">שם המתחם או המגרש.</FieldHelp>
                  <Input
                    value={f.location}
                    onChange={(e) => setF({ ...f, location: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldHelp title="באיזה יום משחקים?">
                    בחירת יום ממלאת את התאריך הקרוב אוטומטית.
                  </FieldHelp>
                  <div className="weekday-picker">
                    {dayNames.map((name, i) => (
                      <button
                        type="button"
                        key={name}
                        className={selectedDay === i ? "active" : ""}
                        onClick={() => {
                          setSelectedDay(i);
                          setF({ ...f, match_date: nextWeekday(i) });
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="date-preview">
                    <span>התאריך שנבחר</span>
                    <Input
                      type="date"
                      value={f.match_date}
                      onChange={(e) =>
                        setF({ ...f, match_date: e.target.value })
                      }
                    />
                  </div>
                </div>
                <div>
                  <FieldHelp title="שעות">שעת התחלה ושעת סיום.</FieldHelp>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      type="time"
                      value={f.start_time}
                      onChange={(e) =>
                        setF({ ...f, start_time: e.target.value })
                      }
                    />
                    <Input
                      type="time"
                      value={f.end_time}
                      onChange={(e) => setF({ ...f, end_time: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div>
                <h3 className="field-group-title">תכנון שחקנים וקבוצות</h3>
                <div className="form-grid triple">
                  <div>
                    <FieldHelp title="יעד נרשמים">
                      מספר המקומות בהרשמה.
                    </FieldHelp>
                    <Input
                      type="number"
                      value={f.capacity}
                      onChange={(e) => setF({ ...f, capacity: e.target.value })}
                    />
                  </div>
                  <div>
                    <FieldHelp title="מקסימום קבוצות">הכמות המרבית.</FieldHelp>
                    <Input
                      type="number"
                      value={f.team_count}
                      onChange={(e) =>
                        setF({ ...f, team_count: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <FieldHelp title="גודל קבוצה רצוי">
                      משמש לחלוקה האוטומטית.
                    </FieldHelp>
                    <Input
                      type="number"
                      value={f.team_size}
                      onChange={(e) =>
                        setF({ ...f, team_size: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
              <Button
                disabled={!f.match_date || create.isPending}
                onClick={() => create.mutate()}
              >
                פתיחת הרשמה
              </Button>
            </Card>
          )}
          <div className="admin-match-list">
            {matches.map((m) => (
              <Card key={m.id}>
                <div className="admin-match-row">
                  <div>
                    <Badge>{statusLabel(m.status)}</Badge>
                    <h2>{m.title}</h2>
                    <p>
                      {formatDate(m.match_date)} · {m.start_time.slice(0, 5)}
                    </p>
                  </div>
                  <div className="action-row">
                    {m.status === "registration_open" && (
                      <>
                        <Tooltip label="שליחת התראה למי שעדיין לא רשום">
                          <Button
                            variant="secondary"
                            onClick={() =>
                              rpc(
                                "notify_missing_players",
                                { p_match_id: m.id },
                                "נשלחה קריאה לשחקנים",
                              )
                            }
                          >
                            <BellRing size={17} />
                            חסרים
                          </Button>
                        </Tooltip>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            rpc(
                              "set_match_registration",
                              { p_match_id: m.id, p_open: false },
                              "ההרשמה נסגרה",
                            )
                          }
                        >
                          <Lock size={17} />
                          סגירה
                        </Button>
                      </>
                    )}
                    {m.status === "registration_closed" && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            rpc(
                              "set_match_registration",
                              { p_match_id: m.id, p_open: true },
                              "ההרשמה נפתחה מחדש",
                            )
                          }
                        >
                          <Unlock size={17} />
                          פתיחה
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            rpc(
                              "generate_balanced_teams",
                              { p_match_id: m.id },
                              "הקבוצות נוצרו",
                            )
                          }
                        >
                          <Shuffle size={17} />
                          ערבוב
                        </Button>
                      </>
                    )}
                    {["teams_published", "registration_closed"].includes(
                      m.status,
                    ) &&
                      !m.ratings_open && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            rpc(
                              "open_match_ratings",
                              { p_match_id: m.id },
                              "הדירוג נפתח",
                            )
                          }
                        >
                          פתיחת דירוג
                        </Button>
                      )}
                    {isMainAdmin && (
                      <Button
                        variant="danger"
                        onClick={() =>
                          confirm("למחוק את המשחק וכל הנתונים שלו?") &&
                          rpc(
                            "delete_match",
                            { p_match_id: m.id },
                            "המשחק נמחק",
                          )
                        }
                      >
                        <Trash2 size={17} />
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
      {tab === "polls" && (
        <>
          <Button onClick={() => setPollOpen(!pollOpen)}>
            <CalendarCheck size={18} />
            סקר חדש
          </Button>
          {pollOpen && (
            <Card className="form-card">
              <div>
                <h2>פתיחת סקר חדש</h2>
                <p>
                  אפשר ליצור כמה סקרים באותו שבוע, למשל סקר נפרד לכל משחק
                  מתוכנן.
                </p>
              </div>
              <div className="form-grid">
                <div>
                  <FieldHelp title="שם הסקר">
                    לדוגמה: “משחק שלישי” או “משחק שישי בבוקר”.
                  </FieldHelp>
                  <Input
                    value={pollForm.title}
                    onChange={(e) =>
                      setPollForm({ ...pollForm, title: e.target.value })
                    }
                  />
                </div>
                <div>
                  <FieldHelp title="השבוע שאליו הסקר שייך">
                    ברירת המחדל היא השבוע הנוכחי.
                  </FieldHelp>
                  <Input
                    type="date"
                    value={pollForm.week_start}
                    onChange={(e) =>
                      setPollForm({ ...pollForm, week_start: e.target.value })
                    }
                  />
                </div>
                <div className="md:col-span-2">
                  <FieldHelp title="הסבר אופציונלי">
                    מידע שהשחקנים צריכים לדעת.
                  </FieldHelp>
                  <Input
                    value={pollForm.description}
                    onChange={(e) =>
                      setPollForm({ ...pollForm, description: e.target.value })
                    }
                  />
                </div>
              </div>
              <Button
                disabled={createPoll.isPending || !pollForm.week_start}
                onClick={() => createPoll.mutate()}
              >
                פתיחת הסקר
              </Button>
            </Card>
          )}
          <div className="admin-match-list">
            {polls.map((p: any) => {
              const voteCount = p.availability_votes?.[0]?.count || 0;
              const unavailableCount = p.weekly_poll_responses?.[0]?.count || 0;
              return (
                <Card key={p.id}>
                  <div className="admin-match-row">
                    <div>
                      <Badge>{p.status === "open" ? "פתוח" : "סגור"}</Badge>
                      <h2>{p.title || "סקר זמינות"}</h2>
                      <p>
                        {formatDate(p.week_start)} · {voteCount} בחירות ימים ·{" "}
                        {unavailableCount} לא יכולים
                      </p>
                    </div>
                    <div className="action-row">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          location.assign(`/availability?poll=${p.id}`)
                        }
                      >
                        צפייה
                      </Button>
                      <Button variant="secondary" onClick={() => editPoll(p)}>
                        <Edit3 size={16} />
                        עריכה
                      </Button>
                      {p.status === "open" ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updatePoll(
                              p.id,
                              {
                                status: "closed",
                                closed_at: new Date().toISOString(),
                              },
                              "הסקר נסגר",
                            )
                          }
                        >
                          <Lock size={16} />
                          סגירה
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updatePoll(
                              p.id,
                              { status: "open", closed_at: null },
                              "הסקר נפתח מחדש",
                            )
                          }
                        >
                          <Unlock size={16} />
                          פתיחה
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => duplicatePoll(p)}
                      >
                        <Copy size={16} />
                        שכפול
                      </Button>
                      <Button variant="danger" onClick={() => deletePoll(p)}>
                        <Trash2 size={16} />
                        מחיקה
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
            {!polls.length && (
              <Card className="empty-state">
                <CalendarCheck />
                <h2>אין סקרים</h2>
                <p>פתח את הסקר הראשון לקבוצה.</p>
              </Card>
            )}
          </div>
        </>
      )}
      {tab === "members" && (
        <div className="member-admin-grid">
          {members.map((m: any) => (
            <Card
              key={m.id}
              className={m.status !== "active" ? "member-inactive" : ""}
            >
              <div className="member-head">
                <div className="player-avatar">
                  {m.profiles?.first_name?.[0] || "ש"}
                </div>
                <div>
                  <h2>{fullName(m.profiles)}</h2>
                  <p>
                    {m.role === "admin" || m.role === "moderator"
                      ? "מנהל קבוצה"
                      : m.status === "active"
                        ? "חבר פעיל"
                        : "הוסר מהקבוצה"}
                  </p>
                </div>
              </div>
              {m.role !== "admin" && (
                <>
                  {m.status === "active" && (
                    <div className="permission-grid">
                      {perms.map(([key, label]) => {
                        const on = m.member_permissions?.some(
                          (p: any) => p.permission_key === key,
                        );
                        return (
                          <label key={key}>
                            <span>{label}</span>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) =>
                                togglePerm(m, key, e.target.checked)
                              }
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <div className="action-row mt-4">
                    {m.status === "active" ? (
                      <>
                        <Button
                          variant="danger"
                          onClick={() =>
                            confirm("להסיר את השחקן?") &&
                            rpc(
                              "remove_group_member",
                              { p_member_id: m.id, p_permanent: false },
                              "השחקן הוסר",
                            )
                          }
                        >
                          <UserMinus size={17} />
                          הסרה
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            confirm("מחיקה קבועה. להמשיך?") &&
                            rpc(
                              "remove_group_member",
                              { p_member_id: m.id, p_permanent: true },
                              "המשתמש נמחק",
                            )
                          }
                        >
                          <Trash2 size={17} />
                          מחיקה קבועה
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={() =>
                          rpc(
                            "restore_group_member",
                            { p_member_id: m.id },
                            "השחקן הוחזר",
                          )
                        }
                      >
                        <UserPlus size={17} />
                        החזרה
                      </Button>
                    )}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

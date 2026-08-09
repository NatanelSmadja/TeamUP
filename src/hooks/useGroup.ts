import {useEffect, useMemo, useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '../lib/supabase';
import {useAuth} from '../contexts/AuthContext';
import type {Group, Member} from '../types';

type GroupSession = {member: Member; group: Group; permissions: string[]};
const activeGroupKey = (userId?: string) => `teamup_active_group_id:${userId || 'guest'}`;
const GROUP_CHANGE_EVENT = 'teamup:group-change';

export function useGroup() {
  const {user} = useAuth();
  const storageKey = activeGroupKey(user?.id);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(storageKey));
  useEffect(() => {
    setActiveId(localStorage.getItem(storageKey));
  }, [storageKey]);
  useEffect(() => {
    const sync = () => setActiveId(localStorage.getItem(storageKey));
    window.addEventListener(GROUP_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(GROUP_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [storageKey]);
  const query = useQuery({
    queryKey: ['my-groups', user?.id],
    enabled: !!user,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const {data, error} = await supabase.rpc('my_active_group_sessions');
      if (error) throw error;
      return (data || []).map((session: any) => ({
        member: session.member as Member,
        group: session.group as Group,
        permissions: (session.permissions || []) as string[],
      })) as GroupSession[];
    },
  });
  const memberships = query.data || [];
  const pendingId = localStorage.getItem('teamup_pending_group');
  const selected = useMemo(() => memberships.find((x) => x.group.id === pendingId) || memberships.find((x) => x.group.id === activeId) || memberships[0] || null, [memberships, activeId, pendingId]);
  useEffect(() => {
    if (selected && selected.group.id !== activeId) {
      localStorage.setItem(storageKey, selected.group.id);
      setActiveId(selected.group.id);
    }
    if (selected && selected.group.id === pendingId) localStorage.removeItem('teamup_pending_group');
    else if (!selected && activeId) {
      localStorage.removeItem(storageKey);
      setActiveId(null);
    }
  }, [selected, activeId, pendingId, storageKey]);
  const setActiveGroupId = (id: string) => {
    localStorage.setItem(storageKey, id);
    setActiveId(id);
    window.dispatchEvent(new Event(GROUP_CHANGE_EVENT));
  };
  return {...query, data: selected, memberships, setActiveGroupId};
}
export function canManage(g: ReturnType<typeof useGroup>['data'], permission?: string) {
  if (!g) return false;
  if (g.group.owner_id === g.member.user_id || g.member.role === 'admin') return true;
  if (!permission) return g.permissions.length > 0;
  return g.permissions.includes(permission);
}
export function isGroupOwner(g: ReturnType<typeof useGroup>['data']) {
  return !!g && g.group.owner_id === g.member.user_id;
}
export const isSystemAdmin = (profile?: {is_system_admin?: boolean} | null) => profile?.is_system_admin === true;

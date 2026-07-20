import {useQuery} from '@tanstack/react-query';
import {supabase} from '../lib/supabase';
import {useAuth} from '../contexts/AuthContext';
import type {Group,Member} from '../types';
export function useGroup(){const {user}=useAuth();return useQuery({queryKey:['my-group',user?.id],enabled:!!user,queryFn:async()=>{const {data:membership,error}=await supabase.from('group_members').select('*, groups(*)').eq('user_id',user!.id).eq('status','active').limit(1).maybeSingle();if(error)throw error;if(!membership)return null;const {data:permissions,error:pe}=await supabase.from('member_permissions').select('permission_key').eq('group_member_id',membership.id);if(pe)throw pe;return {member:membership as Member,group:(membership as any).groups as Group,permissions:(permissions||[]).map(x=>x.permission_key)};}})}
export function canManage(g:ReturnType<typeof useGroup>['data'],permission?:string){if(!g)return false;if(g.member.role==='admin')return true;if(!permission)return g.member.role==='moderator'||g.permissions.length>0;return g.member.role==='moderator'||g.permissions.includes(permission)}

export const isSystemAdmin=(profile?:{is_system_admin?:boolean}|null)=>profile?.is_system_admin===true;

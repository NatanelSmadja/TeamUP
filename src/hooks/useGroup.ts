import {useEffect,useMemo,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {supabase} from '../lib/supabase';
import {useAuth} from '../contexts/AuthContext';
import type {Group,Member} from '../types';

type GroupSession={member:Member;group:Group;permissions:string[]};
const activeGroupKey=(userId?:string)=>`teamup_active_group_id:${userId||'guest'}`;
const GROUP_CHANGE_EVENT='teamup:group-change';

export function useGroup(){
 const {user}=useAuth();
 const storageKey=activeGroupKey(user?.id);
 const [activeId,setActiveId]=useState<string|null>(()=>localStorage.getItem(storageKey));
 useEffect(()=>{setActiveId(localStorage.getItem(storageKey))},[storageKey]);
 useEffect(()=>{const sync=()=>setActiveId(localStorage.getItem(storageKey));window.addEventListener(GROUP_CHANGE_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(GROUP_CHANGE_EVENT,sync);window.removeEventListener('storage',sync)}},[storageKey]);
 const query=useQuery({
  queryKey:['my-groups',user?.id],enabled:!!user,
  queryFn:async()=>{
   const {data:memberships,error}=await supabase.from('group_members').select('*, groups(*)').eq('user_id',user!.id).eq('status','active').order('joined_at');
   if(error)throw error;
   const valid=(memberships||[]).filter((m:any)=>m.groups&&m.groups.lifecycle_status==='active');
   const ids=valid.map((m:any)=>m.id);
   const {data:permissions,error:pe}=ids.length?await supabase.from('member_permissions').select('group_member_id,permission_key').in('group_member_id',ids):{data:[],error:null};
   if(pe)throw pe;
   return valid.map((membership:any)=>({member:membership as Member,group:membership.groups as Group,permissions:(permissions||[]).filter((p:any)=>p.group_member_id===membership.id).map((p:any)=>p.permission_key)})) as GroupSession[];
  }
 });
 const memberships=query.data||[];
 const selected=useMemo(()=>memberships.find(x=>x.group.id===activeId)||memberships[0]||null,[memberships,activeId]);
 useEffect(()=>{if(selected&&selected.group.id!==activeId){localStorage.setItem(storageKey,selected.group.id);setActiveId(selected.group.id)}else if(!selected&&activeId){localStorage.removeItem(storageKey);setActiveId(null)}},[selected,activeId,storageKey]);
 const setActiveGroupId=(id:string)=>{if(!memberships.some(x=>x.group.id===id))return;localStorage.setItem(storageKey,id);setActiveId(id);window.dispatchEvent(new Event(GROUP_CHANGE_EVENT))};
 return {...query,data:selected,memberships,setActiveGroupId};
}
export function canManage(g:ReturnType<typeof useGroup>['data'],permission?:string){if(!g)return false;if(g.group.owner_id===g.member.user_id||g.member.role==='admin')return true;if(!permission)return g.member.role==='moderator'||g.permissions.length>0;return g.member.role==='moderator'||g.permissions.includes(permission)}
export function isGroupOwner(g:ReturnType<typeof useGroup>['data']){return !!g&&g.group.owner_id===g.member.user_id}
export const isSystemAdmin=(profile?:{is_system_admin?:boolean}|null)=>profile?.is_system_admin===true;

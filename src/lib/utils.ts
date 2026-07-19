import {clsx,type ClassValue} from 'clsx';import type {Profile} from '../types';
export const cn=(...v:ClassValue[])=>clsx(v);
export const fullName=(p?:Profile|null)=>p?`${p.first_name||''} ${p.last_name||''}`.trim()||'שחקן':'שחקן';
export const statusLabel=(status:string)=>({draft:'טיוטה',registration_open:'ההרשמה פתוחה',registration_closed:'ההרשמה נסגרה',teams_published:'הקבוצות פורסמו',completed:'המשחק הסתיים',cancelled:'המשחק בוטל'}[status]||status);
export const positionLabel=(value?:string|null)=>({goalkeeper:'שוער',defender:'מגן',midfielder:'קשר',winger:'כנף',striker:'חלוץ',utility:'כללי'}[value||'']||'לא הוגדר');
export const footLabel=(value?:string|null)=>({right:'ימין',left:'שמאל',both:'שתי רגליים'}[value||'']||'לא הוגדר');
export const profilePositionLabels=(p?:Partial<Profile>|null)=>{const positions=Array.isArray(p?.preferred_positions)&&p!.preferred_positions!.length?p!.preferred_positions!:(p?.preferred_position?[p.preferred_position]:[]);return positions.filter(Boolean).map(positionLabel).join(' · ')||'ללא עמדה';};

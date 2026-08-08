import {clsx,type ClassValue} from 'clsx';import type {Profile} from '../types';
export const cn=(...v:ClassValue[])=>clsx(v);
export const fullName=(p?:Profile|null)=>p?`${p.first_name||''} ${p.last_name||''}`.trim()||'שחקן':'שחקן';
export const statusLabel=(status:string)=>({draft:'טיוטה',registration_open:'ההרשמה פתוחה',registration_closed:'ההרשמה נסגרה',teams_published:'הקבוצות פורסמו',completed:'המשחק הסתיים',cancelled:'המשחק בוטל'}[status]||status);
export const positionLabel=(value?:string|null)=>({goalkeeper:'שוער',defender:'מגן',midfielder:'קשר',winger:'כנף',striker:'חלוץ',utility:'כללי'}[value||'']||'לא הוגדר');
export const footLabel=(value?:string|null)=>({right:'ימין',left:'שמאל',both:'שתי רגליים'}[value||'']||'לא הוגדר');

const israelToday=()=>{const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const get=(type:string)=>parts.find(p=>p.type===type)?.value||'';return `${get('year')}-${get('month')}-${get('day')}`};
export const pollDayDate=(weekStart:string,day:number)=>{const [year,month,date]=weekStart.split('-').map(Number);const value=new Date(Date.UTC(year,month-1,date+day));return value.toISOString().slice(0,10)};
export const isPollDayPast=(weekStart:string,day:number)=>pollDayDate(weekStart,day)<israelToday();
export const isPollPast=(weekStart:string)=>isPollDayPast(weekStart,6);

export const roleLabel=(role?:string,permissions:string[]=[])=>role==='admin'||role==='moderator'||permissions.length>=5?'מנהל קבוצה':permissions.length?'מנהל מוגבל':'שחקן';

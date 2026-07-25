import {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Bell, CheckCheck, ChevronLeft} from 'lucide-react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate} from 'react-router-dom';
import {supabase} from '../lib/supabase';
import {useAuth} from '../contexts/AuthContext';
import {useRealtimeInvalidation} from '../hooks/useRealtime';

export default function NotificationCenter() {
    const {user} = useAuth();
    const [open, setOpen] = useState(false);
    const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
    const [popoverTop, setPopoverTop] = useState(58);
    const [desktopLeft, setDesktopLeft] = useState(10);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const qc = useQueryClient();
    const navigate = useNavigate();
    const {data = []} = useQuery({
        queryKey: ['notifications', user?.id], enabled: !!user, queryFn: async () => {
            const {
                data,
                error
            } = await supabase.from('notifications').select('*').eq('user_id', user!.id).order('created_at', {ascending: false}).limit(30);
            if (error) throw error;
            return data || []
        }
    });
    useRealtimeInvalidation(`notifications-${user?.id}`, ['notifications'], [['notifications', user?.id]], !!user);
    const unread = data.filter((x: any) => !x.is_read).length;
    useEffect(() => {
        const query = window.matchMedia('(max-width: 768px)');
        const update = () => setMobile(query.matches);
        query.addEventListener('change', update);
        return () => query.removeEventListener('change', update)
    }, []);
    useEffect(() => {
        if (!open) return;
        const updatePosition = () => {
            const triggerRect = triggerRef.current?.getBoundingClientRect();
            if (triggerRect) {
                const popoverWidth = 360;
                setPopoverTop(triggerRect.bottom + 8);
                setDesktopLeft(Math.max(10, Math.min(triggerRect.right - popoverWidth, window.innerWidth - popoverWidth - 10)));
            }
        };
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [open]);
    useEffect(() => {
        if (!user) return;
        const c = supabase.channel(`device-notifications-${user.id}-${crypto.randomUUID()}`).on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`
        }, async (payload: any) => {
            if (Notification.permission === 'granted') {
                const reg = await navigator.serviceWorker?.getRegistration();
                reg?.showNotification(payload.new.title || 'TEAMUP', {
                    body: payload.new.message || '',
                    icon: '/icon-192.png',
                    badge: '/icon-192.png',
                    tag: payload.new.id,
                    data: {entity_type: payload.new.entity_type, entity_id: payload.new.entity_id}
                })
            }
        }).subscribe();
        return () => {
            void supabase.removeChannel(c)
        }
    }, [user]);
    const markAll = async () => {
        await supabase.from('notifications').update({is_read: true}).eq('user_id', user!.id).eq('is_read', false);
        qc.invalidateQueries({queryKey: ['notifications', user?.id]})
    };
    const target = (n: any) => n.type === 'group_join_request' ? '/group-settings' : ['group_join_approved', 'group_join_rejected'].includes(n.type) ? '/groups' : n.entity_type === 'match' && n.entity_id ? `/matches/${n.entity_id}` : n.entity_type === 'poll' ? `/availability${n.entity_id ? `?poll=${n.entity_id}` : ''}` : n.entity_type === 'rating' ? '/ratings' : '/';
    const openNotification = async (n: any) => {
        if (!n.is_read) {
            await supabase.from('notifications').update({is_read: true}).eq('id', n.id).eq('user_id', user!.id);
            qc.setQueryData(['notifications', user?.id], (old: any[] | undefined) => (old || []).map(x => x.id === n.id ? {
                ...x,
                is_read: true
            } : x))
        }
        if (n.type === 'group_join_request' && n.entity_id && user?.id) {
            localStorage.setItem(`teamup_active_group_id:${user.id}`, n.entity_id);
            window.dispatchEvent(new Event('teamup:group-change'))
        }
        setOpen(false);
        navigate(target(n))
    };
    const popover = <div className="notification-popover" style={mobile
        ? {position: 'fixed', top: popoverTop, bottom: 'auto', left: 10, right: 10, width: 'auto', maxHeight: 'calc(100dvh - 90px)'}
        : {position: 'fixed', top: popoverTop, left: desktopLeft, right: 'auto', width: 360}}>
        <div className="notification-head">
            <div><strong>התראות</strong>{unread > 0 && <small>{unread} לא נקראו</small>}</div>
            <button title="סימון הכול כנקרא" onClick={markAll}><CheckCheck size={18}/></button>
        </div>
        {data.length ? data.map((n: any) => <button type="button" onClick={() => openNotification(n)} key={n.id}
                                                    className={`notification-item notification-link ${n.is_read ? '' : 'unread'}`}>
            <div><strong>{n.title}</strong><p>{n.message}</p>
                <time>{new Date(n.created_at).toLocaleString('he-IL', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })}</time>
            </div>
            <ChevronLeft size={18}/></button>) : <p className="empty-note">אין התראות חדשות</p>}</div>;
    return <div className="notification-center">
        <button ref={triggerRef} className="icon-button" title="התראות" aria-expanded={open} onClick={() => setOpen(!open)}><Bell
            size={20}/>{unread > 0 && <b>{unread}</b>}</button>
        {open && createPortal(popover, document.body)}</div>
}

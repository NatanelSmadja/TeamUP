import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL; const key=import.meta.env.VITE_SUPABASE_ANON_KEY;
export const isSupabaseConfigured=Boolean(url&&key&&!url.includes('YOUR_PROJECT'));
export const supabase=createClient(url||'https://placeholder.supabase.co',key||'placeholder',{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

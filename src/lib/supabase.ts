import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

console.log('[supabase] VITE_SUPABASE_URL defined:', !!url, '| first 30 chars:', url?.slice(0, 30));
console.log('[supabase] VITE_SUPABASE_ANON_KEY defined:', !!key);

if (!url || !key) {
  console.error('[supabase] MISSING env vars — check .env file. App will not work.');
}

export const supabase = createClient(url, key);

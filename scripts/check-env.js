import { loadEnv } from 'vite';
const env = {...loadEnv('production', process.cwd(), ''), ...process.env};
if (!['demo','supabase'].includes(env.VITE_DATA_MODE)) throw Error('Set VITE_DATA_MODE to demo or supabase');
if (env.VERCEL_ENV === 'production' && env.VITE_DATA_MODE !== 'supabase') throw Error('Production requires Supabase');
if (env.VITE_DATA_MODE === 'supabase' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY)) throw Error('Missing Supabase public configuration');

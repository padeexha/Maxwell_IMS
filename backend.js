import { createClient } from '@supabase/supabase-js';
export const mode = import.meta.env.VITE_DATA_MODE;
if (!['demo','supabase'].includes(mode)) throw Error('Set VITE_DATA_MODE in .env.local; see README.');
export const hosted = mode === 'supabase';
export const client = hosted ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) : null;
export async function command(action, payload) {
 const {data,error}=await client.rpc('inventory_command',{action,payload});
 if(error) throw error;
 return data;
}
async function rows(table) {
 // Explicit pagination avoids Supabase's default 1,000-row truncation.
 const all=[];
 for(let start=0;;start+=500){
  const {data,error}=await client.from(table).select('*').order('id').range(start,start+499);
  if(error) throw error;
  all.push(...data); if(data.length<500) return all;
 }
}
export async function snapshot() {
 const {data:{user},error}=await client.auth.getUser();
 if(error){if(error.name==='AuthSessionMissingError')throw Error('Sign in to access your inventory.');throw error;}
 if(!user) throw Error('Please sign in.');
 const {data:profile,error:profileError}=await client.from('profiles').select('*').eq('id',user.id).single();
 if(profileError || !profile?.active) throw Error('Your account has no active staff access. Contact an administrator.');
 const [products,units,activities,users]=await Promise.all(['products','units','activities','profiles'].map(rows));
 users.forEach(u=>u.initials=u.name.split(' ').map(x=>x[0]).slice(0,2).join(''));
 activities.sort((a,b)=>b.at.localeCompare(a.at));
 return {db:{products,units,activities,users},profile};
}

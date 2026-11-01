import { createClient } from '@supabase/supabase-js';
export const hosted = import.meta.env.VITE_DATA_MODE === 'supabase';
const mode = import.meta.env.VITE_DATA_MODE;
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export let configurationError = '';
export let client = null;
try {
  if (!['demo','supabase'].includes(mode)) throw Error('The app configuration is missing. Contact the administrator.');
  if (hosted) {
    if(!url || !key) throw Error('The database connection is not configured. Contact the administrator.');
    client = createClient(url,key);
  }
} catch(error) { configurationError = error.message; }
export async function command(action, payload) {
  const {data,error} = await client.rpc('inventory_command',{action,payload});
  if(error) throw error;
  return data;
}
async function rows(table) {
  const all=[];
  for(let start=0;;start+=500){
    const {data,error}=await client.from(table).select('*').order('id').range(start,start+499);
    if(error) throw error;
    all.push(...data); if(data.length<500) return all;
  }
}
export async function snapshot() {
  const {data:{user},error}=await client.auth.getUser();
  if(error){ if(error.name==='AuthSessionMissingError') throw Object.assign(Error('Sign in to access your inventory.'),{code:'SIGNED_OUT'}); throw error; }
  if(!user) throw Object.assign(Error('Sign in to access your inventory.'),{code:'SIGNED_OUT'});
  const {data:profile,error:profileError}=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(profileError) throw profileError;
  if(!profile?.active) throw Object.assign(Error('Your account has no active staff access. Ask your administrator to provision your current account.'),{code:'NO_ACCESS'});
  const [products,units,activities,users]=await Promise.all(['products','units','activities','profiles'].map(rows));
  // Recheck access after reads so a revocation mid-refresh cannot produce a partial, misleading view.
  const {data:latest,error:latestError}=await client.from('profiles').select('*').eq('id',user.id).maybeSingle();
  if(latestError) throw latestError;
  if(!latest?.active || latest.role!==profile.role) throw Object.assign(Error('Your access changed. Sign in again to continue.'),{code:'NO_ACCESS'});
  activities.sort((a,b)=>b.at.localeCompare(a.at));
  return {db:{products,units,activities,users},profile:latest};
}


async function rpc(name, params = {}) {
  const { data, error } = await client.rpc(name, params);
  if (error) throw error;
  return data;
}
export const listPrintAgents = () => rpc('list_print_agents');
export const createPrintAgent = name => rpc('create_print_agent', { p_name: name });
export const setPrintAgentActive = (id, active) => rpc('set_print_agent_active', { p_agent_id: id, p_active: active });
export const enqueuePrintJob = (agentId, labels) => rpc('enqueue_print_job', { p_agent_id: agentId, p_labels: labels });

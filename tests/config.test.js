import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const check=env=>spawnSync(process.execPath,['scripts/check-env.js'],{env:{...process.env,VITE_DATA_MODE:'',VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:'',VERCEL_ENV:'',...env}}).status;
test('deployment fails closed for missing config and production demo',()=>{
 assert.notEqual(check({}),0);
 assert.equal(check({VITE_DATA_MODE:'demo'}),0);
 assert.notEqual(check({VITE_DATA_MODE:'demo',VERCEL_ENV:'production'}),0);
 assert.notEqual(check({VITE_DATA_MODE:'supabase'}),0);
 assert.equal(check({VITE_DATA_MODE:'supabase',VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example',VERCEL_ENV:'production'}),0);
});

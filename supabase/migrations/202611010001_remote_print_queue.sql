begin;

create table public.printer_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_seen timestamptz
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  agent_id uuid not null references public.printer_agents(id),
  labels jsonb not null check (jsonb_typeof(labels) = 'array'),
  status text not null default 'queued' check (status in ('queued', 'printing', 'printed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index print_jobs_agent_queue on public.print_jobs(agent_id, status, created_at);
create index print_jobs_requester on public.print_jobs(requested_by, created_at desc);

alter table public.printer_agents enable row level security;
alter table public.print_jobs enable row level security;
revoke all on public.printer_agents from anon, authenticated;
revoke all on public.print_jobs from anon, authenticated;
grant select on public.print_jobs to authenticated;
create policy print_jobs_read on public.print_jobs for select to authenticated
using (
  requested_by = auth.uid()
  or public.staff_role() in ('Administrator', 'Manager')
);

create function public.create_print_agent(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.profiles;
  v_token text;
  v_agent public.printer_agents;
begin
  select * into staff from public.profiles where id = auth.uid() and active for share;
  if staff.id is null or staff.role <> 'Administrator' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) < 1 or length(trim(p_name)) > 100 then
    raise exception 'Printer server name must be 1 to 100 characters';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.printer_agents(name, token_hash, created_by)
  values (trim(p_name), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), staff.id)
  returning * into v_agent;
  return jsonb_build_object('id', v_agent.id, 'name', v_agent.name, 'token', v_token);
end
$$;

create function public.set_print_agent_active(p_agent_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare staff public.profiles;
begin
  select * into staff from public.profiles where id = auth.uid() and active for share;
  if staff.id is null or staff.role <> 'Administrator' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  update public.printer_agents set active = p_active where id = p_agent_id;
  if not found then raise exception 'Printer server not found'; end if;
end
$$;

create function public.list_print_agents() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare staff public.profiles; result jsonb;
begin
  select * into staff from public.profiles where id = auth.uid() and active;
  if staff.id is null then raise exception 'Active staff access required' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'active', a.active,
    'online', a.active and a.last_seen > now() - interval '45 seconds',
    'last_seen', a.last_seen
  ) order by a.name), '[]'::jsonb)
  into result from public.printer_agents a;
  return result;
end
$$;

create function public.enqueue_print_job(p_agent_id uuid, p_labels jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  staff public.profiles;
  v_agent public.printer_agents;
  v_job public.print_jobs;
  label jsonb;
  label_name text;
  label_code text;
begin
  select * into staff from public.profiles where id = auth.uid() and active for share;
  if staff.id is null then raise exception 'Active staff access required' using errcode = '42501'; end if;
  select * into v_agent from public.printer_agents where id = p_agent_id and active;
  if v_agent.id is null then raise exception 'Select an active printer server'; end if;
  if jsonb_typeof(p_labels) <> 'array' or jsonb_array_length(p_labels) < 1 or jsonb_array_length(p_labels) > 100 then
    raise exception 'Provide between 1 and 100 labels';
  end if;
  for label in select value from jsonb_array_elements(p_labels) loop
    if jsonb_typeof(label) <> 'object' then raise exception 'Each label must be an object'; end if;
    label_name := label->>'name';
    label_code := label->>'barcode';
    if label_name is null or length(label_name) > 200 then raise exception 'Label names must be text up to 200 characters'; end if;
    if label_code is null or length(trim(label_code)) < 1 or length(label_code) > 200 then raise exception 'Label codes must be text between 1 and 200 characters'; end if;
  end loop;
  if (select count(*) from public.print_jobs where agent_id = p_agent_id and status in ('queued', 'printing')) >= 500 then
    raise exception 'Printer queue is full. Try again after pending jobs finish.';
  end if;
  insert into public.print_jobs(requested_by, agent_id, labels)
  values (staff.id, v_agent.id, p_labels) returning * into v_job;
  return jsonb_build_object('id', v_job.id, 'status', v_job.status, 'created_at', v_job.created_at);
end
$$;

create function public.validate_print_agent(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_agent public.printer_agents;
begin
  if p_token is null or length(p_token) <> 64 then raise exception 'Invalid printer server token' using errcode = '42501'; end if;
  select * into v_agent from public.printer_agents
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and active;
  if v_agent.id is null then raise exception 'Invalid or disabled printer server token' using errcode = '42501'; end if;
  update public.printer_agents set last_seen = now() where id = v_agent.id;
  return jsonb_build_object('id', v_agent.id, 'name', v_agent.name);
end
$$;

create function public.claim_print_job(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_agent public.printer_agents;
  v_job public.print_jobs;
begin
  if p_token is null or length(p_token) <> 64 then raise exception 'Invalid printer server token' using errcode = '42501'; end if;
  select * into v_agent from public.printer_agents
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and active;
  if v_agent.id is null then raise exception 'Invalid or disabled printer server token' using errcode = '42501'; end if;
  update public.printer_agents set last_seen = now() where id = v_agent.id
    and (last_seen is null or last_seen < now() - interval '15 seconds');
  update public.print_jobs set status = 'failed', error = 'Printer server stopped before confirming this job.', updated_at = now(), completed_at = now()
  where agent_id = v_agent.id and status = 'printing' and attempts >= 3 and updated_at < now() - interval '3 minutes';
  select * into v_job from public.print_jobs
  where agent_id = v_agent.id and (
    status = 'queued' or (status = 'printing' and attempts < 3 and updated_at < now() - interval '3 minutes')
  ) order by created_at for update skip locked limit 1;
  if v_job.id is null then return null; end if;
  update public.print_jobs set status = 'printing', attempts = attempts + 1, updated_at = now(), error = ''
  where id = v_job.id returning * into v_job;
  return jsonb_build_object('id', v_job.id, 'labels', v_job.labels, 'attempt', v_job.attempts);
end
$$;

create function public.finish_print_job(p_token text, p_job_id uuid, p_success boolean, p_error text default '') returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_agent public.printer_agents;
begin
  if p_token is null or length(p_token) <> 64 then raise exception 'Invalid printer server token' using errcode = '42501'; end if;
  select * into v_agent from public.printer_agents
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and active;
  if v_agent.id is null then raise exception 'Invalid or disabled printer server token' using errcode = '42501'; end if;
  update public.print_jobs set
    status = case when p_success then 'printed' else 'failed' end,
    error = case when p_success then '' else left(coalesce(p_error, 'Print failed'), 500) end,
    updated_at = now(), completed_at = now()
  where id = p_job_id and agent_id = v_agent.id and status = 'printing';
  if not found then raise exception 'Print job is no longer assigned to this printer server'; end if;
  return true;
end
$$;

revoke all on function public.create_print_agent(text) from public, anon;
revoke all on function public.set_print_agent_active(uuid, boolean) from public, anon;
revoke all on function public.list_print_agents() from public, anon;
revoke all on function public.enqueue_print_job(uuid, jsonb) from public, anon;
revoke all on function public.validate_print_agent(text) from public, authenticated;
revoke all on function public.claim_print_job(text) from public, authenticated;
revoke all on function public.finish_print_job(text, uuid, boolean, text) from public, authenticated;
grant execute on function public.create_print_agent(text), public.set_print_agent_active(uuid, boolean), public.list_print_agents(), public.enqueue_print_job(uuid, jsonb) to authenticated;
grant execute on function public.validate_print_agent(text), public.claim_print_job(text), public.finish_print_job(text, uuid, boolean, text) to anon;

commit;

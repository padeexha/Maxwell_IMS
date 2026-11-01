begin;

create function public.delete_print_agent(p_agent_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  staff public.profiles;
begin
  select * into staff from public.profiles where id = auth.uid() and active for share;
  if staff.id is null or staff.role <> 'Administrator' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  -- Remove dependent queued jobs before deleting the agent; the confirmation in
  -- the admin UI warns that this also removes completed print-job history.
  delete from public.print_jobs where agent_id = p_agent_id;
  delete from public.printer_agents where id = p_agent_id;
  if not found then raise exception 'Printer server not found'; end if;
end
$$;

revoke all on function public.delete_print_agent(uuid) from public, anon;
grant execute on function public.delete_print_agent(uuid) to authenticated;

commit;

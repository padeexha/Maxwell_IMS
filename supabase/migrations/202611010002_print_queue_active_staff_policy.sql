begin;
drop policy print_jobs_read on public.print_jobs;
create policy print_jobs_read on public.print_jobs for select to authenticated
using (
  public.staff_role() is not null
  and (requested_by = auth.uid() or public.staff_role() in ('Administrator', 'Manager'))
);
commit;

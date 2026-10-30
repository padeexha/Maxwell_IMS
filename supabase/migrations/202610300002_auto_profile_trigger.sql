create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  user_name text;
  user_role text;
  user_email text;
begin
  user_email := coalesce(new.email, 'staff@maxwell.example');
  begin
    user_name := coalesce(new.raw_user_meta_data->>'name', split_part(user_email, '@', 1));
    user_role := coalesce(new.raw_user_meta_data->>'role', 'Worker');
  exception when others then
    user_name := split_part(user_email, '@', 1);
    user_role := 'Worker';
  end;

  if user_role not in ('Administrator', 'Manager', 'Worker') then
    user_role := 'Worker';
  end if;

  insert into public.profiles (id, name, email, role, active)
  values (
    new.id,
    coalesce(nullif(trim(user_name), ''), 'Staff Member'),
    user_email,
    user_role,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

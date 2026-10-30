begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 120),
 email text not null,
 role text not null check(role in ('Administrator','Manager','Worker')),
 active boolean not null default true
);
create table public.products (
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 200),
 brand text not null default '', sku text not null unique check(sku=upper(trim(sku)) and length(sku) between 1 and 100),
 category text not null, model text not null default '',
 "reorderLevel" integer not null default 0 check("reorderLevel">=0),
 "unitValue" numeric(14,2) not null default 0 check("unitValue">=0 and "unitValue"<>'NaN'::numeric)
);
create table public.units (
 id uuid primary key default gen_random_uuid(), code text not null unique default ('MSM-'||upper(replace(gen_random_uuid()::text,'-',''))),
 "productId" uuid not null references public.products(id), serial text not null default '',
 status text not null default 'Available' check(status in ('Available','Sold','Repair')),
 "receivedAt" timestamptz not null default now(), "soldAt" timestamptz, "returnedAt" timestamptz,
 reference text not null default '', version integer not null default 1
);
create unique index units_serial_unique on public.units(lower(serial)) where serial<>'';
create index units_product on public.units("productId");
create table public.activities (
 id uuid primary key default gen_random_uuid(), type text not null, "unitCode" text not null default '',
 text text not null, actor uuid not null, "by" text not null, at timestamptz not null default now()
);
create function public.staff_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=auth.uid() and active
$$;
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.units enable row level security;
alter table public.activities enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (public.staff_role()='Administrator' or (id=auth.uid() and active));
create policy products_read on public.products for select to authenticated using (public.staff_role() is not null);
create policy units_read on public.units for select to authenticated using (public.staff_role() is not null);
create policy activities_read on public.activities for select to authenticated using (public.staff_role() in ('Administrator','Manager'));
revoke all on public.profiles,public.products,public.units,public.activities from anon,authenticated;
grant select on public.profiles,public.products,public.units,public.activities to authenticated;

create function public.inventory_command(action text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 staff public.profiles; item public.units; created public.units; target public.profiles;
 qty integer; i integer; result jsonb='[]'; event_type text; event_text text; desired text;
begin
 -- Lock the caller profile so access revocation cannot race a stock mutation.
 select * into staff from public.profiles where id=auth.uid() and active for share;
 if staff.id is null then raise exception 'Active staff access required' using errcode='42501'; end if;
 if action in ('create_product','update_product','delete_product','set_value','set_access') and staff.role<>'Administrator' then
  raise exception 'Administrator access required' using errcode='42501';
 end if;
 if action='receive' and staff.role not in ('Administrator','Manager') then
  raise exception 'Manager access required' using errcode='42501';
 end if;
 if action='create_product' then
  insert into public.products(name,brand,sku,category,model,"reorderLevel","unitValue") values
  (payload->>'name',coalesce(payload->>'brand',''),upper(trim(payload->>'sku')),payload->>'category',coalesce(payload->>'model',''),(payload->>'reorderLevel')::integer,(payload->>'unitValue')::numeric);
  event_type='product'; event_text='Created product '||(payload->>'sku');
 elsif action='update_product' then
  update public.products set
   name=trim(payload->>'name'),
   brand=coalesce(payload->>'brand',''),
   sku=upper(trim(payload->>'sku')),
   category=payload->>'category',
   model=coalesce(payload->>'model',''),
   "reorderLevel"=(payload->>'reorderLevel')::integer,
   "unitValue"=(payload->>'unitValue')::numeric
  where id=(payload->>'id')::uuid;
  if not found then raise exception 'Product not found'; end if;
  event_type='product'; event_text='Updated product '||coalesce(payload->>'sku', payload->>'id');
 elsif action='delete_product' then
  if exists (select 1 from public.units where "productId"=(payload->>'id')::uuid) then
   raise exception 'Cannot delete product with existing stock units' using errcode='23503';
  end if;
  delete from public.products where id=(payload->>'id')::uuid returning sku into desired;
  if not found then raise exception 'Product not found'; end if;
  event_type='product'; event_text='Deleted product '||coalesce(desired, payload->>'id');
 elsif action='set_value' then
  update public.products set "unitValue"=(payload->>'value')::numeric where id=(payload->>'id')::uuid;
  if not found then raise exception 'Product not found'; end if;
  event_type='product'; event_text='Changed product value: '||(payload->>'id')||' to '||(payload->>'value');
 elsif action='receive' then
  qty=(payload->>'quantity')::integer;
  if qty is null or qty<1 or qty>100 or jsonb_typeof(payload->'serials')<>'array' or payload->'serials' is null or jsonb_array_length(payload->'serials')>qty then raise exception 'Invalid receiving quantity or serials'; end if;
  for i in 0..qty-1 loop
   insert into public.units("productId",serial,reference) values ((payload->>'productId')::uuid,trim(coalesce(payload->'serials'->>i,'')),coalesce(payload->>'reference','')) returning * into created;
   insert into public.activities(type,"unitCode",text,actor,"by") values ('add',created.code,'Received into stock',staff.id,staff.name);
   result=result||jsonb_build_array(to_jsonb(created));
  end loop;
  return result;
 elsif action='transition' then
  select * into item from public.units where id=(payload->>'id')::uuid for update;
  if item.id is null then raise exception 'Unit not found'; end if;
  if (payload->>'version')::integer is distinct from item.version then raise exception 'Stock changed. Refresh and try again.' using errcode='40001'; end if;
  desired=payload->>'status';
  if item.status='Available' and desired='Sold' then event_type='sale'; event_text='Marked as sold';
  elsif item.status='Sold' and desired='Available' then event_type='return'; event_text='Returned to stock';
  elsif item.status='Available' and desired='Repair' then event_type='alert'; event_text='Marked for repair';
  elsif item.status='Repair' and desired='Available' and staff.role in ('Administrator','Manager') then event_type='repair'; event_text='Repair completed';
  else raise exception 'Invalid stock transition'; end if;
  update public.units set status=desired, version=version+1,
   "soldAt"=case when desired='Sold' then now() else "soldAt" end,
   "returnedAt"=case when event_type='return' then now() else "returnedAt" end where id=item.id;
 elsif action='set_access' then
  if (payload->>'id')::uuid=staff.id then raise exception 'Cannot change your own access'; end if;
  select * into target from public.profiles where id=(payload->>'id')::uuid for update;
  if target.id is null then raise exception 'Profile not found; provision the user first'; end if;
  update public.profiles set role=payload->>'role',active=(payload->>'active')::boolean where id=target.id;
  event_type='access'; event_text='Changed access for '||target.email||': '||(payload->>'role')||', active='||(payload->>'active');
 else raise exception 'Unknown action'; end if;
 insert into public.activities(type,"unitCode",text,actor,"by") values (event_type,coalesce(item.code,''),event_text,staff.id,staff.name);
 return result;
end $$;
revoke all on function public.staff_role(),public.inventory_command(text,jsonb) from public,anon;
grant execute on function public.staff_role(),public.inventory_command(text,jsonb) to authenticated;
commit;

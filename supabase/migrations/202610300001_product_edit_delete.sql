create or replace function public.inventory_command(action text, payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
 staff public.profiles;
 item public.units;
 target public.profiles;
 created public.units;
 desired text;
 qty integer;
 event_type text;
 event_text text;
 result jsonb := '[]'::jsonb;
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

revoke all on function public.inventory_command(text,jsonb) from public,anon;
grant execute on function public.inventory_command(text,jsonb) to authenticated;

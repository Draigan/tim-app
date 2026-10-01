-- Only the superuser may archive a customer. Staff keep update access to the
-- rest of the row (and can still restore), so this is a trigger rather than a
-- column grant. Calls without a user JWT (service role, cron, SQL editor) pass.

create or replace function app_private.guard_customer_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null
     and new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and not app_private.current_user_is_superuser() then
    raise exception 'Only the superuser can archive customers.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_guard_archive on public.customers;
create trigger customers_guard_archive
before update of archived_at on public.customers
for each row
execute function app_private.guard_customer_archive();

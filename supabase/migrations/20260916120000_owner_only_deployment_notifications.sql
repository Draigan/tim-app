-- Deployment and pickup announcements are the one notification stream the owner
-- sees and the superuser does not. The 'admin' audience now means
-- owner-but-not-superuser; 'staff' stays shared by both; 'superuser' stays
-- superuser-only (app errors).
--
-- Every existing 'admin' row is a deployment or pickup announcement, so
-- redefining the audience retrofits the history without touching any data.

drop policy if exists "role scoped app notifications" on public.app_notifications;
drop policy if exists "users can insert own notification reads" on public.app_notification_reads;

create policy "role scoped app notifications"
on public.app_notifications for select
to authenticated
using (
  (
    audience = 'admin'
    and (select app_private.current_user_is_owner())
    and not (select app_private.current_user_is_superuser())
  )
  or (audience = 'billing' and (select app_private.current_user_is_billing_admin()))
  or (audience = 'staff' and (select app_private.current_user_is_owner()))
  or (audience = 'superuser' and (select app_private.current_user_is_superuser()))
);

create policy "users can insert own notification reads"
on public.app_notification_reads for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.app_notifications n
    where n.id = notification_id
      and (
        (
          n.audience = 'admin'
          and (select app_private.current_user_is_owner())
          and not (select app_private.current_user_is_superuser())
        )
        or (n.audience = 'billing' and (select app_private.current_user_is_billing_admin()))
        or (n.audience = 'staff' and (select app_private.current_user_is_owner()))
        or (n.audience = 'superuser' and (select app_private.current_user_is_superuser()))
      )
  )
);

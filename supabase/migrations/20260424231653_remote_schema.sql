
  create table "public"."asset_types" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "created_at" timestamp with time zone default now(),
    "icon" text default '📦'::text
      );


alter table "public"."asset_types" enable row level security;


  create table "public"."assets" (
    "id" uuid not null default gen_random_uuid(),
    "asset_type_id" uuid not null,
    "size" text,
    "label" text not null,
    "notes" text,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."assets" enable row level security;


  create table "public"."calendar_events" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "from_date" date not null,
    "to_date" date not null,
    "notes" text,
    "color" text default 'blue'::text,
    "created_at" timestamp with time zone default now(),
    "start_time" time without time zone,
    "end_time" time without time zone
      );


alter table "public"."calendar_events" enable row level security;


  create table "public"."deployments" (
    "id" uuid not null default gen_random_uuid(),
    "asset_id" uuid not null,
    "address" text not null,
    "lat" double precision not null,
    "lng" double precision not null,
    "customer_name" text,
    "customer_phone" text,
    "notes" text,
    "dropped_at" timestamp with time zone default now(),
    "expires_at" date,
    "picked_up_at" timestamp with time zone,
    "created_at" timestamp with time zone default now(),
    "pickup_notes" text,
    "picked_up_by" text,
    "deployed_by" text
      );


alter table "public"."deployments" enable row level security;


  create table "public"."feedback" (
    "id" uuid not null default gen_random_uuid(),
    "user_email" text,
    "user_name" text,
    "message" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."feedback" enable row level security;


  create table "public"."messages" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "sender_name" text not null,
    "content" text not null,
    "sent_at" timestamp with time zone default now()
      );


alter table "public"."messages" enable row level security;


  create table "public"."push_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "endpoint" text not null,
    "p256dh" text not null,
    "auth" text not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."push_subscriptions" enable row level security;


  create table "public"."reservations" (
    "id" uuid not null default gen_random_uuid(),
    "asset_id" uuid not null,
    "customer_name" text,
    "customer_phone" text,
    "address" text,
    "notes" text,
    "from_date" date not null,
    "to_date" date not null,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."reservations" enable row level security;

CREATE UNIQUE INDEX asset_types_name_key ON public.asset_types USING btree (name);

CREATE UNIQUE INDEX asset_types_pkey ON public.asset_types USING btree (id);

CREATE UNIQUE INDEX assets_pkey ON public.assets USING btree (id);

CREATE UNIQUE INDEX calendar_events_pkey ON public.calendar_events USING btree (id);

CREATE UNIQUE INDEX deployments_pkey ON public.deployments USING btree (id);

CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id);

CREATE UNIQUE INDEX messages_pkey ON public.messages USING btree (id);

CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);

CREATE UNIQUE INDEX push_subscriptions_pkey ON public.push_subscriptions USING btree (id);

CREATE UNIQUE INDEX reservations_pkey ON public.reservations USING btree (id);

alter table "public"."asset_types" add constraint "asset_types_pkey" PRIMARY KEY using index "asset_types_pkey";

alter table "public"."assets" add constraint "assets_pkey" PRIMARY KEY using index "assets_pkey";

alter table "public"."calendar_events" add constraint "calendar_events_pkey" PRIMARY KEY using index "calendar_events_pkey";

alter table "public"."deployments" add constraint "deployments_pkey" PRIMARY KEY using index "deployments_pkey";

alter table "public"."feedback" add constraint "feedback_pkey" PRIMARY KEY using index "feedback_pkey";

alter table "public"."messages" add constraint "messages_pkey" PRIMARY KEY using index "messages_pkey";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_pkey" PRIMARY KEY using index "push_subscriptions_pkey";

alter table "public"."reservations" add constraint "reservations_pkey" PRIMARY KEY using index "reservations_pkey";

alter table "public"."asset_types" add constraint "asset_types_name_key" UNIQUE using index "asset_types_name_key";

alter table "public"."assets" add constraint "assets_asset_type_id_fkey" FOREIGN KEY (asset_type_id) REFERENCES public.asset_types(id) not valid;

alter table "public"."assets" validate constraint "assets_asset_type_id_fkey";

alter table "public"."deployments" add constraint "deployments_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES public.assets(id) not valid;

alter table "public"."deployments" validate constraint "deployments_asset_id_fkey";

alter table "public"."messages" add constraint "messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."messages" validate constraint "messages_user_id_fkey";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_endpoint_key" UNIQUE using index "push_subscriptions_endpoint_key";

alter table "public"."push_subscriptions" add constraint "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."push_subscriptions" validate constraint "push_subscriptions_user_id_fkey";

alter table "public"."reservations" add constraint "reservations_asset_id_fkey" FOREIGN KEY (asset_id) REFERENCES public.assets(id) not valid;

alter table "public"."reservations" validate constraint "reservations_asset_id_fkey";

set check_function_bodies = off;

create or replace view "public"."active_deployments" as  SELECT d.id,
    d.asset_id,
    d.address,
    d.lat,
    d.lng,
    d.customer_name,
    d.customer_phone,
    d.notes,
    d.dropped_at,
    d.expires_at,
    d.picked_up_at,
    d.created_at,
    d.pickup_notes,
    d.picked_up_by,
    d.deployed_by,
    a.label,
    a.size,
    a.notes AS asset_notes,
    a.asset_type_id,
    t.name AS type_name,
    t.icon AS type_icon
   FROM ((public.deployments d
     JOIN public.assets a ON ((a.id = d.asset_id)))
     JOIN public.asset_types t ON ((t.id = a.asset_type_id)))
  WHERE (d.picked_up_at IS NULL);


CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

create or replace view "public"."yard_assets" as  SELECT a.id,
    a.asset_type_id,
    a.size,
    a.label,
    a.notes,
    a.created_at,
    t.name AS type_name
   FROM (public.assets a
     JOIN public.asset_types t ON ((t.id = a.asset_type_id)))
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.deployments d
          WHERE ((d.asset_id = a.id) AND (d.picked_up_at IS NULL)))));


grant delete on table "public"."asset_types" to "anon";

grant insert on table "public"."asset_types" to "anon";

grant references on table "public"."asset_types" to "anon";

grant select on table "public"."asset_types" to "anon";

grant trigger on table "public"."asset_types" to "anon";

grant truncate on table "public"."asset_types" to "anon";

grant update on table "public"."asset_types" to "anon";

grant delete on table "public"."asset_types" to "authenticated";

grant insert on table "public"."asset_types" to "authenticated";

grant references on table "public"."asset_types" to "authenticated";

grant select on table "public"."asset_types" to "authenticated";

grant trigger on table "public"."asset_types" to "authenticated";

grant truncate on table "public"."asset_types" to "authenticated";

grant update on table "public"."asset_types" to "authenticated";

grant delete on table "public"."asset_types" to "service_role";

grant insert on table "public"."asset_types" to "service_role";

grant references on table "public"."asset_types" to "service_role";

grant select on table "public"."asset_types" to "service_role";

grant trigger on table "public"."asset_types" to "service_role";

grant truncate on table "public"."asset_types" to "service_role";

grant update on table "public"."asset_types" to "service_role";

grant delete on table "public"."assets" to "anon";

grant insert on table "public"."assets" to "anon";

grant references on table "public"."assets" to "anon";

grant select on table "public"."assets" to "anon";

grant trigger on table "public"."assets" to "anon";

grant truncate on table "public"."assets" to "anon";

grant update on table "public"."assets" to "anon";

grant delete on table "public"."assets" to "authenticated";

grant insert on table "public"."assets" to "authenticated";

grant references on table "public"."assets" to "authenticated";

grant select on table "public"."assets" to "authenticated";

grant trigger on table "public"."assets" to "authenticated";

grant truncate on table "public"."assets" to "authenticated";

grant update on table "public"."assets" to "authenticated";

grant delete on table "public"."assets" to "service_role";

grant insert on table "public"."assets" to "service_role";

grant references on table "public"."assets" to "service_role";

grant select on table "public"."assets" to "service_role";

grant trigger on table "public"."assets" to "service_role";

grant truncate on table "public"."assets" to "service_role";

grant update on table "public"."assets" to "service_role";

grant delete on table "public"."calendar_events" to "anon";

grant insert on table "public"."calendar_events" to "anon";

grant references on table "public"."calendar_events" to "anon";

grant select on table "public"."calendar_events" to "anon";

grant trigger on table "public"."calendar_events" to "anon";

grant truncate on table "public"."calendar_events" to "anon";

grant update on table "public"."calendar_events" to "anon";

grant delete on table "public"."calendar_events" to "authenticated";

grant insert on table "public"."calendar_events" to "authenticated";

grant references on table "public"."calendar_events" to "authenticated";

grant select on table "public"."calendar_events" to "authenticated";

grant trigger on table "public"."calendar_events" to "authenticated";

grant truncate on table "public"."calendar_events" to "authenticated";

grant update on table "public"."calendar_events" to "authenticated";

grant delete on table "public"."calendar_events" to "service_role";

grant insert on table "public"."calendar_events" to "service_role";

grant references on table "public"."calendar_events" to "service_role";

grant select on table "public"."calendar_events" to "service_role";

grant trigger on table "public"."calendar_events" to "service_role";

grant truncate on table "public"."calendar_events" to "service_role";

grant update on table "public"."calendar_events" to "service_role";

grant delete on table "public"."deployments" to "anon";

grant insert on table "public"."deployments" to "anon";

grant references on table "public"."deployments" to "anon";

grant select on table "public"."deployments" to "anon";

grant trigger on table "public"."deployments" to "anon";

grant truncate on table "public"."deployments" to "anon";

grant update on table "public"."deployments" to "anon";

grant delete on table "public"."deployments" to "authenticated";

grant insert on table "public"."deployments" to "authenticated";

grant references on table "public"."deployments" to "authenticated";

grant select on table "public"."deployments" to "authenticated";

grant trigger on table "public"."deployments" to "authenticated";

grant truncate on table "public"."deployments" to "authenticated";

grant update on table "public"."deployments" to "authenticated";

grant delete on table "public"."deployments" to "service_role";

grant insert on table "public"."deployments" to "service_role";

grant references on table "public"."deployments" to "service_role";

grant select on table "public"."deployments" to "service_role";

grant trigger on table "public"."deployments" to "service_role";

grant truncate on table "public"."deployments" to "service_role";

grant update on table "public"."deployments" to "service_role";

grant delete on table "public"."feedback" to "anon";

grant insert on table "public"."feedback" to "anon";

grant references on table "public"."feedback" to "anon";

grant select on table "public"."feedback" to "anon";

grant trigger on table "public"."feedback" to "anon";

grant truncate on table "public"."feedback" to "anon";

grant update on table "public"."feedback" to "anon";

grant delete on table "public"."feedback" to "authenticated";

grant insert on table "public"."feedback" to "authenticated";

grant references on table "public"."feedback" to "authenticated";

grant select on table "public"."feedback" to "authenticated";

grant trigger on table "public"."feedback" to "authenticated";

grant truncate on table "public"."feedback" to "authenticated";

grant update on table "public"."feedback" to "authenticated";

grant delete on table "public"."feedback" to "service_role";

grant insert on table "public"."feedback" to "service_role";

grant references on table "public"."feedback" to "service_role";

grant select on table "public"."feedback" to "service_role";

grant trigger on table "public"."feedback" to "service_role";

grant truncate on table "public"."feedback" to "service_role";

grant update on table "public"."feedback" to "service_role";

grant delete on table "public"."messages" to "anon";

grant insert on table "public"."messages" to "anon";

grant references on table "public"."messages" to "anon";

grant select on table "public"."messages" to "anon";

grant trigger on table "public"."messages" to "anon";

grant truncate on table "public"."messages" to "anon";

grant update on table "public"."messages" to "anon";

grant delete on table "public"."messages" to "authenticated";

grant insert on table "public"."messages" to "authenticated";

grant references on table "public"."messages" to "authenticated";

grant select on table "public"."messages" to "authenticated";

grant trigger on table "public"."messages" to "authenticated";

grant truncate on table "public"."messages" to "authenticated";

grant update on table "public"."messages" to "authenticated";

grant delete on table "public"."messages" to "service_role";

grant insert on table "public"."messages" to "service_role";

grant references on table "public"."messages" to "service_role";

grant select on table "public"."messages" to "service_role";

grant trigger on table "public"."messages" to "service_role";

grant truncate on table "public"."messages" to "service_role";

grant update on table "public"."messages" to "service_role";

grant delete on table "public"."push_subscriptions" to "anon";

grant insert on table "public"."push_subscriptions" to "anon";

grant references on table "public"."push_subscriptions" to "anon";

grant select on table "public"."push_subscriptions" to "anon";

grant trigger on table "public"."push_subscriptions" to "anon";

grant truncate on table "public"."push_subscriptions" to "anon";

grant update on table "public"."push_subscriptions" to "anon";

grant delete on table "public"."push_subscriptions" to "authenticated";

grant insert on table "public"."push_subscriptions" to "authenticated";

grant references on table "public"."push_subscriptions" to "authenticated";

grant select on table "public"."push_subscriptions" to "authenticated";

grant trigger on table "public"."push_subscriptions" to "authenticated";

grant truncate on table "public"."push_subscriptions" to "authenticated";

grant update on table "public"."push_subscriptions" to "authenticated";

grant delete on table "public"."push_subscriptions" to "service_role";

grant insert on table "public"."push_subscriptions" to "service_role";

grant references on table "public"."push_subscriptions" to "service_role";

grant select on table "public"."push_subscriptions" to "service_role";

grant trigger on table "public"."push_subscriptions" to "service_role";

grant truncate on table "public"."push_subscriptions" to "service_role";

grant update on table "public"."push_subscriptions" to "service_role";

grant delete on table "public"."reservations" to "anon";

grant insert on table "public"."reservations" to "anon";

grant references on table "public"."reservations" to "anon";

grant select on table "public"."reservations" to "anon";

grant trigger on table "public"."reservations" to "anon";

grant truncate on table "public"."reservations" to "anon";

grant update on table "public"."reservations" to "anon";

grant delete on table "public"."reservations" to "authenticated";

grant insert on table "public"."reservations" to "authenticated";

grant references on table "public"."reservations" to "authenticated";

grant select on table "public"."reservations" to "authenticated";

grant trigger on table "public"."reservations" to "authenticated";

grant truncate on table "public"."reservations" to "authenticated";

grant update on table "public"."reservations" to "authenticated";

grant delete on table "public"."reservations" to "service_role";

grant insert on table "public"."reservations" to "service_role";

grant references on table "public"."reservations" to "service_role";

grant select on table "public"."reservations" to "service_role";

grant trigger on table "public"."reservations" to "service_role";

grant truncate on table "public"."reservations" to "service_role";

grant update on table "public"."reservations" to "service_role";


  create policy "authenticated full access"
  on "public"."asset_types"
  as permissive
  for all
  to public
using ((auth.uid() IS NOT NULL))
with check ((auth.uid() IS NOT NULL));



  create policy "authenticated full access"
  on "public"."assets"
  as permissive
  for all
  to public
using ((auth.uid() IS NOT NULL))
with check ((auth.uid() IS NOT NULL));



  create policy "auth"
  on "public"."calendar_events"
  as permissive
  for all
  to public
using ((auth.role() = 'authenticated'::text));



  create policy "authenticated full access"
  on "public"."deployments"
  as permissive
  for all
  to public
using ((auth.uid() IS NOT NULL))
with check ((auth.uid() IS NOT NULL));



  create policy "authenticated full access"
  on "public"."feedback"
  as permissive
  for all
  to public
using ((auth.uid() IS NOT NULL))
with check ((auth.uid() IS NOT NULL));



  create policy "authenticated users can read messages"
  on "public"."messages"
  as permissive
  for select
  to public
using ((auth.uid() IS NOT NULL));



  create policy "users can insert own messages"
  on "public"."messages"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "users manage own subscriptions"
  on "public"."push_subscriptions"
  as permissive
  for all
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));



  create policy "authenticated full access"
  on "public"."reservations"
  as permissive
  for all
  to public
using ((auth.uid() IS NOT NULL))
with check ((auth.uid() IS NOT NULL));




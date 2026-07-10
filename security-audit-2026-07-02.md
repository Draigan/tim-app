# Security Audit - 2026-07-02

Scope: React/Vite frontend, Supabase schema and Edge Functions, Stripe payment flows, dependency audit, and secret exposure checks.

Original audit note captured findings and verification state. Updated after the role/RLS remediation work.

## 2026-07-02 Remediation Update

Implemented and applied `supabase/migrations/20260702225710_explicit_app_roles.sql`.

Resolved:

- Replaced broad `authenticated` admin revenue/payment policies with superuser-only RLS.
- Replaced "any authenticated user is staff" behavior with explicit app roles.
- Added app roles:
  - `superuser`: `d@d.d`
  - `owner`: `tim@timberfell.ca`
  - `driver`: `beau@timberfell.ca`
- Added owner read-only storage occupancy/rate access while keeping storage writes and billing actions superuser-only.
- Updated frontend route/navigation gating to match the role model.
- Updated the `admin-users` Edge Function so only superuser can create/delete/change users, and new users can only be assigned `owner` or `driver`.
- Tightened billing/card/storage SMS Edge Functions to superuser-only.
- Kept review request sending available to `superuser`, `owner`, and `driver`.

Verification after applying the migration:

- `supabase db push --yes` applied `20260702225710_explicit_app_roles.sql`.
- `supabase db lint --linked` passed with no schema errors.
- `supabase db advisors --linked --type security -o json` now reports only `auth_leaked_password_protection`.
- `npm run build` passed after the frontend role changes.
- `deno check` passed for the modified Edge Functions.

Current RLS status: no linked Supabase security-advisor RLS findings remain. Remaining security items are listed below.

## Findings

### Resolved: Admin revenue/payment RLS allowed any authenticated user

Supabase linked security advisor originally flagged always-true RLS policies on:

- `public.admin_revenue_receipts`
- `public.admin_payment_received`
- `public.admin_payment_hidden`
- `public.admin_manual_payments`

The policies used `USING (true)` and `WITH CHECK (true)`, effectively allowing any authenticated user to read and mutate those admin payment tables.

Resolution: `20260702225710_explicit_app_roles.sql` drops those policies and recreates them as superuser-only via `app_private.current_user_can_manage_revenue()`.

Relevant files:

- `supabase/migrations/20260605000000_admin_revenue_receipts.sql`
- `supabase/migrations/20260605000001_admin_payment_received.sql`
- `supabase/migrations/20260605000002_admin_payment_hidden.sql`
- `supabase/migrations/20260623140627_admin_manual_cash_payments.sql`
- `src/App.jsx`
- `src/pages/AdminRevenue.jsx`

### Resolved: "staff" meant any authenticated user

`app_private.current_user_is_staff()` originally returned true when `auth.role() = 'authenticated'`. That meant any authenticated Supabase user received broad staff-level access in many RLS policies.

Resolution: `20260702225710_explicit_app_roles.sql` now uses explicit app roles from `app_metadata.role` plus fixed transition email fallbacks for `d@d.d`, `tim@timberfell.ca`, and `beau@timberfell.ca`.

Relevant file:

- `supabase/migrations/20260531215416_tighten_rls_roles.sql`

### Medium: Public payment portal has weak brute-force resistance

The storage payment portal authenticates customers with phone number plus a 5-digit `payment_pin`. The portal intentionally runs without Supabase JWT verification and uses the service role internally.

The handler slows failed attempts slightly, but there is no repo-level rate limit, attempt log, lockout, or stronger one-time token flow.

Recommended fix: add attempt tracking and throttling by phone, PIN, IP, and user-agent where available. Consider replacing the static 5-digit PIN with expiring magic links or longer per-customer tokens.

Relevant files:

- `supabase/functions/storage-payment-portal/index.ts`
- `supabase/migrations/20260614161149_add_payment_portal.sql`

### High: npm dependency audit has unresolved vulnerabilities

`npm audit --omit=dev` reported 11 production vulnerabilities. `npm audit` reported 13 total.

Notable affected packages in the lockfile include:

- `react-router-dom@7.14.1`
- `react-router@7.14.1`
- `vite@8.0.8`
- `serialize-javascript@6.0.2`
- `ws@8.20.0`
- `fast-uri`
- `form-data`

`npm audit fix --dry-run` failed because the current lockfile has a peer dependency conflict between Vite 8 and `vite-plugin-pwa@1.2.0`.

Recommended fix:

- Update `react-router-dom` to at least `7.18.1`.
- Update `vite` to at least `8.1.3`.
- Update `vite-plugin-pwa` to `1.3.0`, which declares Vite 8 support.
- Regenerate `package-lock.json` from a clean install and rerun `npm audit`.

Relevant files:

- `package.json`
- `package-lock.json`

### Medium: Edge Function dependencies are not fully reproducible

Supabase Edge Functions import major/unversioned dependencies directly, including:

- `https://esm.sh/@supabase/supabase-js@2`
- `https://esm.sh/stripe@16?target=deno`
- `npm:web-push`

`deno.lock` is currently untracked, so function dependency resolution is not fully reproducible from git.

Recommended fix: pin exact versions through function `deno.json` import maps and commit `deno.lock`.

Relevant files:

- `supabase/functions/*/index.ts`
- `supabase/functions/*/deno.json`
- `deno.lock`

### Medium: Supabase leaked password protection is disabled

Supabase linked advisor reported leaked password protection disabled for Auth.

Recommended fix: enable leaked password protection in Supabase Auth password security settings.

## Positive Notes

- No common high-risk token or private-key patterns were found in tracked files.
- `.gitignore` excludes `.env`, `.env.*`, and `*.local`, while keeping `.env.example`.
- Stripe webhook handling verifies `stripe-signature` before processing events.
- Cron-style unauthenticated Edge Functions use secret headers.
- Public booking and customer payment flows recalculate amounts server-side instead of trusting client-provided totals.
- Card setup links store hashed invite tokens and use Stripe Checkout setup mode.

## Verification Performed

Commands/checks run:

- `npm audit --omit=dev --json`
- `npm audit --json`
- `npm audit fix --dry-run --json`
- `npm outdated --json`
- `npm ls react-router-dom react-router vite vite-plugin-pwa @vitejs/plugin-react @tailwindcss/vite --depth=3`
- `supabase db advisors --linked --type security -o json`
- Secret-pattern scans across tracked files and the working tree
- Targeted review of Supabase Edge Functions, RLS migrations, and Stripe flows
- `deno lint supabase/functions`
- `npm run lint`

Verification gaps:

- `supabase db advisors --local --type security` could not run because the local Supabase database container was not running on `127.0.0.1:54322`.
- `deno lint supabase/functions` failed with existing lint debt.
- `npm run lint` failed with existing lint debt.

## Stripe Maintenance Note

The Edge Functions pin Stripe API version `2026-04-22.dahlia`. This is a valid GA Dahlia version, but Stripe's official changelog shows later Dahlia GA releases through June 24, 2026.

Review Stripe API versioning deliberately during the next payment maintenance pass and centralize the API version constant instead of scattering it across functions.

Reference:

- https://docs.stripe.com/changelog/dahlia

# Storage Feature Plan

## What we're building

A **Storage tab** (admin only) that gives Tim a billing view of everything he collects monthly rent on:
- Fixed storage units at his facility (occupied or vacant)
- Portable storage assets currently deployed on sites

---

## Open questions (waiting on Tim)

None — ready to build.

---

## Data model

### New table: `storage_units`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `unit_number` | text | e.g. "A1", "B12" |
| `tenant_name` | text nullable | null = vacant |
| `tenant_phone` | text nullable | |
| `monthly_rate` | numeric nullable | |
| `move_in_date` | date nullable | |
| `payment_frequency` | text nullable | `monthly`, `weekly`, `one_time`, `other` |
| `billing_day` | integer nullable | for monthly: day of month (1–28); for weekly: day of week (0–6) |
| `notes` | text nullable | |
| `created_at` | timestamptz | |

### New table: `storage_payments`
Shared payment history for both fixed units and portable storage deployments.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `unit_id` | uuid nullable FK → `storage_units` | one of these two must be set |
| `deployment_id` | uuid nullable FK → `deployments` | |
| `period_label` | text | e.g. "2026-05" for monthly, "2026-W21" for weekly, "Deposit" for one-time |
| `paid_at` | timestamptz | when Tim marked it paid |
| `amount` | numeric nullable | actual amount collected |

### Modified table: `deployments`
Add `payment_frequency` (text nullable) and `billing_day` (integer nullable) — set when a portable storage asset is deployed. `billing_day` defaults to the day of the drop date when frequency is monthly. Only relevant for portable storage type assets.

### RLS
Both new tables: authenticated users full access (same as existing tables).

---

## UI

### Bottom nav
Add **Storage** tab (admin only), between Calendar and Chat. Icon: `Warehouse` from lucide-react.

### `/storage` page

**Two sections:**

#### 1. Fixed Units
- Card per unit showing: unit number, tenant name, phone (tap-to-call), monthly rate, paid badge for current month
- Vacant units show a "Vacant" badge, sorted to the bottom
- Cards show billing day: "Due the 1st", "Due the 15th"
- **Overdue** (monthly/weekly only: past billing day, no payment for current period) → amber/red border
- **Due soon** (monthly/weekly only: within 3 days of billing day, unpaid) → subtle amber border
- **Paid** → no highlight
- **One-time / other** → just shows paid/unpaid, no urgency logic
- Vacant units → no billing info, sorted to bottom
- Tap card → opens bottom sheet with full details + payment history

#### 2. Portable Storage
- Pulls from `active_deployments` filtered to Portable Storage asset type
- Card shows: asset label, site address, customer name/phone, paid badge for current month
- Same overdue/due-soon/paid logic using billing_day from the deployment
- Billing day defaults to the day the asset was dropped, editable
- Tap card → same bottom sheet with payment history

**Both sections share:**
- Search bar at top filtering across both
- "Add unit" button (fixed units only, admin)

### Storage bottom sheet (for both types)
- Editable fields (tenant/customer info, rate, notes)
- Paid toggle for current month — inserts or deletes a row in `storage_payments`
- Payment history list: one row per past month, showing month + amount + date paid
- For portable storage: link to map pin (navigates to MapView centered on deployment)

---

## Migration

Single migration file covering:
1. Create `storage_units` table
2. Create `storage_payments` table
3. RLS policies on both

---

---

## SMS reminders

### Infrastructure
- Twilio for SMS delivery
- Twilio credentials stored as Supabase secrets (alongside existing push notification keys)
- One edge function `send-sms` — accepts a phone number + message string, calls Twilio. Single responsibility, reusable.

### Manual reminders
- "Send reminder" button in each unit/deployment bottom sheet
- App calls a Supabase function which calls `send-sms` immediately
- Works for any payment frequency

### Automated reminders
- Extend existing `daily-alerts` cron edge function
- Runs daily, checks for:
  - Units due in 3 days → sends upcoming reminder
  - Units due today → sends due-today reminder
  - Units 3–5 days overdue and still unpaid → sends overdue notice
- Only applies to `monthly` and `weekly` payment frequencies (one-time/other have no predictable due date)

### Deduplication
- `storage_sms_log` table tracks every text sent: unit/deployment, message type, sent_at, phone number
- Cron checks this log before sending — won't send the same message type twice in the same billing period

### Opt-in
- `sms_opt_in` boolean on `storage_units` (default false)
- For portable storage: `sms_opt_in` on the deployment
- Automated reminders only send if opted in — manual button always works regardless

### Message templates
- Due in 3 days: "Hi [name], just a reminder that your storage payment of $[rate] is due on the [day]. - Tim"
- Due today: "Hi [name], your storage payment of $[rate] is due today. - Tim"
- Overdue: "Hi [name], your storage payment of $[rate] was due on the [day] and hasn't been received. Please get in touch. - Tim"

---

## What we're NOT doing

- Bulk "mark all paid"
- VPS relay (edge functions call Twilio directly — keep it self-contained)

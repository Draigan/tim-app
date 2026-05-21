# Storage + Customers Feature Plan

## What we're building

### Storage tab (admin only)
A billing view of everything Tim collects rent on:
- Fixed storage units at his facility (occupied or vacant)
- Portable storage assets currently deployed on sites

### Customers tab (admin only)
A central customer database. Customers link to deployments and storage units so Tim can see a full picture of each person's history in one place.

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

### New table: `customers`
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text NOT NULL | |
| `phone` | text nullable | |
| `email` | text nullable | |
| `notes` | text nullable | |
| `sms_opt_in` | boolean | default false |
| `created_at` | timestamptz | |

### Modified table: `deployments`
Add `customer_id` uuid nullable FK → `customers`. Old records keep their existing `customer_name`/`customer_phone` text fields — no migration. New deployments use `customer_id`.

### Modified table: `storage_units`
Replace `tenant_name`, `tenant_phone` with `customer_id` uuid nullable FK → `customers`. `sms_opt_in` moves to the customer record.

### RLS
All new/modified tables: authenticated users full access (same as existing tables).

---

## UI

### Bottom nav (admin)
Map · Inventory · Storage · Customers · Settings

- **Storage** — `Warehouse` icon
- **Customers** — `Users` icon
- Calendar moved out of nav → accessible via a link in Settings

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
- Add/edit units managed via Asset Manager in Settings

### Storage bottom sheet (for both types)
- Shows linked customer name + phone (tap-to-call) — editing done via Customers tab
- Paid toggle for current period — inserts or deletes a row in `storage_payments`
- Payment history list: one row per period, showing label + amount + date paid
- For portable storage: link to map pin (navigates to MapView centered on deployment)

### Customers tab — `/customers`
- Searchable list of all customers
- Each card: name, phone, count of active deployments + storage units
- Tap → customer profile sheet:
  - Editable fields: name, phone, email, notes, SMS opt-in toggle
  - History section: active deployments, storage units, past deployments
  - Payment history across all their units

### Customer picker (on deploy + storage assignment)
- Typeahead search of existing customers
- "New customer" option creates a record on the fly
- Replaces the raw name/phone text fields for new records

---

## Migration

Single migration file covering:
1. Create `customers` table
2. Create `storage_units` table (with `customer_id` FK)
3. Create `storage_payments` table
4. Add `customer_id`, `payment_frequency`, `billing_day` to `deployments`
5. RLS policies on all new tables

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
- `sms_opt_in` lives on the `customers` record — one setting per person covers all their units and deployments
- Automated reminders only send if opted in — manual button always works regardless

### Message templates
- Due in 3 days: "Hi [name], just a reminder that your storage payment of $[rate] is due on the [day]. - Tim"
- Due today: "Hi [name], your storage payment of $[rate] is due today. - Tim"
- Overdue: "Hi [name], your storage payment of $[rate] was due on the [day] and hasn't been received. Please get in touch. - Tim"

---

## What we're NOT doing

- Bulk "mark all paid"
- VPS relay (edge functions call Twilio directly — keep it self-contained)

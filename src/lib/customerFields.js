export const CUSTOMER_SAFE_COLUMNS = [
  'id',
  'name',
  'phone',
  'email',
  'address',
  'notes',
  'created_at',
  'archived_at',
  'has_payment_method',
  'stripe_customer_id',
].join(', ')
// Note: stripe_customer_id requires the grant in 20260601_grant_stripe_id_read.sql

export const CUSTOMER_WITH_CREDIT_SUMMARY_COLUMNS = `${CUSTOMER_SAFE_COLUMNS}, payment_pin, customer_credits(amount, status)`

export const CUSTOMER_ASSIGN_COLUMNS = [
  'id',
  'name',
  'phone',
  'email',
  'has_payment_method',
  'customer_credits(id, amount, status, period_labels)',
].join(', ')

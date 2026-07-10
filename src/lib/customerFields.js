export const CUSTOMER_BASE_COLUMNS = [
  'id',
  'name',
  'phone',
  'email',
  'address',
  'notes',
  'created_at',
  'archived_at',
].join(', ')

export const CUSTOMER_BILLING_COLUMNS = [
  CUSTOMER_BASE_COLUMNS,
  'has_payment_method',
  'stripe_customer_id',
].join(', ')
// Note: stripe_customer_id requires the grant in 20260601_grant_stripe_id_read.sql

export const CUSTOMER_SAFE_COLUMNS = CUSTOMER_BASE_COLUMNS

export const CUSTOMER_WITH_CREDIT_SUMMARY_COLUMNS = `${CUSTOMER_BILLING_COLUMNS}, payment_pin, customer_credits(amount, status)`

export const CUSTOMER_ASSIGN_COLUMNS = [
  'id',
  'name',
  'phone',
  'email',
  'has_payment_method',
  'customer_credits(id, amount, status, period_labels)',
].join(', ')

-- Stripe retries webhook deliveries (and documents that the same event can
-- occasionally arrive more than once even without an error), and the
-- checkout/invoice webhook handler grants credits on every delivery it
-- processes with no idempotency check — a retried "checkout.session.completed"
-- or "invoice.payment_succeeded" would double-grant credits for the same
-- Stripe event. This constraint makes a second insert for the same event
-- fail instead of silently double-crediting; the application code (see
-- src/app/api/webhooks/stripe/route.ts) treats that failure as "already
-- processed" and skips the balance update.
create unique index if not exists credit_ledger_stripe_event_id_key
  on public.credit_ledger (stripe_event_id)
  where stripe_event_id is not null;

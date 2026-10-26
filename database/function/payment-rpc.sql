-- Server-only RPCs. Apply only after reviewing the schema and deployment roles.
create or replace function public.reserve_duitku_payment(
  p_order_id uuid,
  p_user_id uuid,
  p_idempotency_key text,
  p_payment_method text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.orders%rowtype;
  v_existing public.payments%rowtype;
  v_payment public.payments%rowtype;
  v_items_total bigint;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 16 or length(p_idempotency_key) > 200 then
    raise exception 'invalid_idempotency_key' using errcode = '22023';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  if v_order.currency <> 'IDR' or v_order.order_status not in ('pending','confirmed') then
    raise exception 'order_not_payable' using errcode = '22023';
  end if;

  select coalesce(sum(oi.line_total), 0) into v_items_total
  from public.order_items oi where oi.order_id = v_order.id;
  if v_items_total <> v_order.subtotal_amount
     or v_order.total_amount <> v_order.subtotal_amount + v_order.shipping_cost
     or v_order.total_amount <= 0 then
    raise exception 'order_totals_invalid' using errcode = '22023';
  end if;

  select * into v_existing
  from public.payments
  where order_id = p_order_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    return to_jsonb(v_existing) || jsonb_build_object('reused', true);
  end if;

  insert into public.payments (
    order_id, merchant_order_id, payment_method, amount, currency, status, idempotency_key
  ) values (
    p_order_id,
    'DS-' || replace(gen_random_uuid()::text, '-', ''),
    p_payment_method,
    v_order.total_amount,
    'IDR',
    'pending',
    p_idempotency_key
  )
  returning * into v_payment;

  return to_jsonb(v_payment) || jsonb_build_object('reused', false);
end;
$$;

create or replace function public.apply_duitku_callback(
  p_merchant_order_id text,
  p_merchant_code text,
  p_amount bigint,
  p_result_code text,
  p_reference text,
  p_event_fingerprint text,
  p_signature_valid boolean
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payment public.payments%rowtype;
  v_event_id uuid;
  v_outcome text;
begin
  if not p_signature_valid or p_merchant_order_id is null or p_amount <= 0
     or p_reference is null or p_event_fingerprint is null then
    raise exception 'invalid_callback' using errcode = '22023';
  end if;

  select * into v_payment
  from public.payments
  where merchant_order_id = p_merchant_order_id
  for update;

  if not found or v_payment.amount <> p_amount then
    insert into public.payment_callback_events
      (payment_id, event_fingerprint, result_code, signature_valid, processing_outcome, metadata)
    values
      (null, p_event_fingerprint, coalesce(p_result_code, 'unknown'), true, 'rejected',
       jsonb_build_object('merchant_order_id', p_merchant_order_id, 'merchant_code', p_merchant_code, 'amount', p_amount))
    on conflict (event_fingerprint) do nothing;
    return jsonb_build_object('outcome','rejected','acknowledge',false);
  end if;

  if v_payment.duitku_reference is not null and v_payment.duitku_reference <> p_reference then
    insert into public.payment_callback_events
      (payment_id, event_fingerprint, result_code, signature_valid, processing_outcome, metadata)
    values
      (v_payment.id, p_event_fingerprint, coalesce(p_result_code, 'unknown'), true, 'rejected',
       jsonb_build_object('reason','reference_mismatch'))
    on conflict (event_fingerprint) do nothing;
    return jsonb_build_object('outcome','rejected','acknowledge',false);
  end if;

  insert into public.payment_callback_events
    (payment_id, event_fingerprint, result_code, signature_valid, processing_outcome, metadata)
  values
    (v_payment.id, p_event_fingerprint, coalesce(p_result_code, 'unknown'), true, 'ignored',
     jsonb_build_object('merchant_order_id', p_merchant_order_id, 'reference', p_reference))
  on conflict (event_fingerprint) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('outcome','duplicate','acknowledge',true);
  end if;

  if v_payment.status = 'paid' then
    v_outcome := 'ignored';
  elsif p_result_code = '00' then
    update public.payments
      set status = 'paid',
          duitku_reference = coalesce(duitku_reference, p_reference),
          updated_at = now(),
          paid_at = coalesce(paid_at, now())
      where id = v_payment.id;
    v_outcome := 'applied';
  else
    -- Provider documentation is inconsistent about callback failure codes.
    -- Keep the payment unresolved; do not infer a terminal failure.
    update public.payments
      set status = 'needs_review',
          duitku_reference = coalesce(duitku_reference, p_reference),
          updated_at = now()
      where id = v_payment.id and status <> 'paid';
    v_outcome := 'needs_review';
  end if;

  update public.payment_callback_events set processing_outcome = v_outcome where id = v_event_id;
  return jsonb_build_object('outcome',v_outcome,'acknowledge',true);
end;
$$;

revoke all on function public.reserve_duitku_payment(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.apply_duitku_callback(text, text, bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.reserve_duitku_payment(uuid, uuid, text, text) to service_role;
grant execute on function public.apply_duitku_callback(text, text, bigint, text, text, text, boolean) to service_role;

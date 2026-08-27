begin;

create table if not exists app_private.scheduled_product_publication_failures (
  product_id uuid primary key references public.products(id) on delete cascade,
  first_failed_at timestamptz not null default clock_timestamp(),
  last_failed_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 1 check (attempt_count > 0),
  last_sqlstate text not null,
  last_error text not null
);

revoke all on table app_private.scheduled_product_publication_failures
from public, anon, authenticated, service_role;

create or replace function app_private.activate_due_scheduled_products(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_scanned integer := 0;
  v_published integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
  v_error text;
begin
  delete from app_private.scheduled_product_publication_failures as failures
  where not exists (
    select 1
    from public.products as products
    where products.id = failures.product_id
      and products.status = 'pending'
      and products.paused_at is null
      and products.publish_at <= clock_timestamp()
  );

  for v_product in
    select products.id
    from public.products as products
    where products.status = 'pending'
      and products.paused_at is null
      and products.publish_at <= clock_timestamp()
    order by products.publish_at, products.id
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    begin
      update public.products as products
      set status = 'active'
      where products.id = v_product.id
        and products.status = 'pending'
        and products.paused_at is null
        and products.publish_at <= clock_timestamp();

      if found then
        v_published := v_published + 1;
        delete from app_private.scheduled_product_publication_failures
        where product_id = v_product.id;
      end if;
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_error = message_text;
        v_failed := v_failed + 1;
        insert into app_private.scheduled_product_publication_failures (
          product_id,
          last_sqlstate,
          last_error
        ) values (
          v_product.id,
          coalesce(v_sqlstate, 'XXXXX'),
          left(coalesce(v_error, '예약 공개 처리 실패'), 1000)
        )
        on conflict (product_id) do update set
          last_failed_at = clock_timestamp(),
          attempt_count =
            app_private.scheduled_product_publication_failures.attempt_count + 1,
          last_sqlstate = excluded.last_sqlstate,
          last_error = excluded.last_error;
    end;
  end loop;

  return jsonb_build_object(
    'scanned', v_scanned,
    'published', v_published,
    'failed', v_failed,
    'processedAt', clock_timestamp()
  );
end;
$$;

revoke all on function app_private.activate_due_scheduled_products(integer)
from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobs.jobid
  into v_job_id
  from cron.job as jobs
  where jobs.jobname = 'activate-scheduled-products'
  order by jobs.jobid
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'activate-scheduled-products',
      '* * * * *',
      $job$select app_private.activate_due_scheduled_products();$job$
    );
  else
    perform cron.alter_job(
      v_job_id,
      schedule := '* * * * *',
      command := 'select app_private.activate_due_scheduled_products();',
      active := true
    );
  end if;
end;
$$;

select app_private.activate_due_scheduled_products();

commit;

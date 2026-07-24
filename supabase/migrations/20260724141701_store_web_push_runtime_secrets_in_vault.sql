begin;

set local lock_timeout = '10s';

create or replace function public.get_web_push_public_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'web_push_vapid_public_key'
  limit 1;
$$;

revoke all on function public.get_web_push_public_key()
  from public, anon, authenticated;
grant execute on function public.get_web_push_public_key()
  to service_role;

create or replace function public.get_web_push_delivery_config()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select case
    when count(*) filter (
      where name in (
        'web_push_vapid_public_key',
        'web_push_vapid_private_key',
        'web_push_vapid_subject'
      )
    ) = 3
    then jsonb_build_object(
      'publicKey',
      max(decrypted_secret) filter (where name = 'web_push_vapid_public_key'),
      'privateKey',
      max(decrypted_secret) filter (where name = 'web_push_vapid_private_key'),
      'subject',
      max(decrypted_secret) filter (where name = 'web_push_vapid_subject')
    )
    else null
  end
  from vault.decrypted_secrets;
$$;

revoke all on function public.get_web_push_delivery_config()
  from public, anon, authenticated;
grant execute on function public.get_web_push_delivery_config()
  to service_role;

create or replace function public.verify_web_push_dispatch_secret(
  p_secret text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    extensions.digest(convert_to(coalesce(p_secret, ''), 'UTF8'), 'sha256')
      = extensions.digest(
        convert_to(coalesce(decrypted_secret, ''), 'UTF8'),
        'sha256'
      ),
    false
  )
  from vault.decrypted_secrets
  where name = 'web_push_dispatch_secret'
  limit 1;
$$;

revoke all on function public.verify_web_push_dispatch_secret(text)
  from public, anon, authenticated;
grant execute on function public.verify_web_push_dispatch_secret(text)
  to service_role;

comment on function public.get_web_push_delivery_config()
  is 'Service-role-only access to VAPID delivery keys stored in Supabase Vault.';
comment on function public.verify_web_push_dispatch_secret(text)
  is 'Service-role-only constant-length digest comparison for the cron dispatcher.';

commit;

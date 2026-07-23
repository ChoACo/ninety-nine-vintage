begin;

insert into app_private.ledger_principals (
  id,
  principal_kind,
  created_at,
  anonymized_at
)
select
  profiles.id,
  case when profiles.deleted_at is null then 'account' else 'anonymous_ledger' end,
  profiles.created_at,
  profiles.deleted_at
from public.profiles as profiles
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraints
    where constraints.contype = 'f'
      and constraints.conrelid = 'public.profiles'::regclass
      and constraints.confrelid = 'app_private.ledger_principals'::regclass
      and constraints.conkey = array[
        (
          select attributes.attnum
          from pg_catalog.pg_attribute as attributes
          where attributes.attrelid = 'public.profiles'::regclass
            and attributes.attname = 'id'
            and not attributes.attisdropped
        )
      ]::smallint[]
  ) then
    alter table public.profiles
      add constraint profiles_ledger_principal_fkey
      foreign key (id)
      references app_private.ledger_principals(id)
      on update no action
      on delete restrict
      not valid;

    alter table public.profiles
      validate constraint profiles_ledger_principal_fkey;
  end if;
end;
$$;

commit;

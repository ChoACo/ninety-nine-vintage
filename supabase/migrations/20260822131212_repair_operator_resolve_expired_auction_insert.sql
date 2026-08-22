-- Repair the relist clone INSERT without rewriting the already-applied
-- historical migration. The function definition is read from the catalog so
-- every authorization, reconciliation, audit, and grant contract remains
-- byte-for-byte identical except for the missing past_action value.
do $migration$
declare
  v_signature regprocedure :=
    'public.operator_resolve_expired_auction(uuid,text)'::regprocedure;
  v_definition text;
  v_broken_pattern text :=
    $pattern$0,\s+null,\s+null,\s+null,\s+'auction'$pattern$;
  v_match_count integer;
begin
  select pg_get_functiondef(v_signature)
  into v_definition;

  v_match_count := regexp_count(v_definition, v_broken_pattern, 1, 'i');
  if v_match_count <> 1 then
    raise exception
      'operator_resolve_expired_auction matched % repair locations; refusing an unsafe rewrite',
      v_match_count;
  end if;

  execute regexp_replace(
    v_definition,
    v_broken_pattern,
    E'0,\n      null,\n      null,\n      null,\n      null,\n      \'auction\'',
    'i'
  );
end;
$migration$;

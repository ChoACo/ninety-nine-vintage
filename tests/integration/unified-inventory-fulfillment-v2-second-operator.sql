-- A later production migration creates owner delegation rows for both known
-- operators. The first operator is promoted by a repository migration; this
-- fixture supplies the deployment-time promotion for the second operator.
do $$
declare
  v_result text;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '30be08c2-6259-42c6-af26-4ded6362de12',
    true
  );
  v_result := public.set_member_access_role(
    '9d7b47fc-3cd5-4dfc-aacb-1656e9e4e15d',
    'operator'
  );
  if v_result <> 'operator' then
    raise exception using
      errcode = 'P0001',
      message = 'test fixture could not promote the second operator';
  end if;
end;
$$;

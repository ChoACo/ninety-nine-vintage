begin;

alter table public.products
  alter column category set default '기타';

update public.products
set category = '기타'
where btrim(category) in ('구제 의류', '구제의류');

commit;

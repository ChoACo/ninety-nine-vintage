create table public.staff_board_posts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'discussion')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  body text not null check (char_length(btrim(body)) between 2 and 10000),
  author_id uuid references public.profiles(id) on delete set null,
  author_role text not null check (author_role in ('owner', 'operator', 'employee')),
  is_pinned boolean not null default false,
  image_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_board_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.staff_board_posts(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_role text not null check (author_role in ('owner', 'operator', 'employee')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index staff_board_posts_order_idx
  on public.staff_board_posts (is_pinned desc, created_at desc);
create index staff_board_comments_post_idx
  on public.staff_board_comments (post_id, created_at);

alter table public.staff_board_posts enable row level security;
alter table public.staff_board_comments enable row level security;

revoke all on table public.staff_board_posts from anon, authenticated;
revoke all on table public.staff_board_comments from anon, authenticated;
grant select, insert, update, delete on table public.staff_board_posts to service_role;
grant select, insert, update, delete on table public.staff_board_comments to service_role;

insert into public.staff_board_posts (
  id, kind, title, body, author_role, is_pinned, image_paths, created_at, updated_at
) values (
  '99000000-0000-4000-8000-000000000001',
  'notice',
  '처음 시작하는 운영자 안내서',
  E'신규 운영자는 아래 순서대로 판매 업무를 시작해 주세요.\n\n1. 판매센터 들어가기\n로그인 후 상단의 업무 메뉴에서 판매센터로 이동합니다. 오늘의 할 일 화면에서 처리해야 할 주문과 배송 업무를 먼저 확인하세요.\n\n2. 판매할 매장 확인하기\n화면 왼쪽 위 매장 선택 영역에서 작업할 매장이 맞는지 확인합니다. 소유자가 운영자 화면을 대신 확인하는 경우에는 매장을 먼저 선택해야 합니다.\n\n3. 상품 등록하기\n상품 등록 메뉴에서 간편 등록 또는 엑셀 등록을 선택합니다. 상품명, 가격, 판매 방식, 공개일, 사진을 확인한 뒤 등록하세요.\n\n4. 주문과 낙찰 확인하기\n주문·낙찰 메뉴에서 결제 상태와 구매자를 확인합니다. 구매자 정보는 실제 처리에 필요한 범위에서만 사용합니다.\n\n5. 준비와 배송 처리하기\n준비·배송 메뉴에서 입출고, 보관, 포장, 송장을 순서대로 처리합니다. 센터·그룹별 송장을 기준으로 묶음을 확인하세요.\n\n6. 문의와 정산 확인하기\n회원 채팅에서 구매자 문의에 답변하고, 매출·정산에서 판매 대금과 정산 내역을 확인합니다.\n\n화면이나 처리 방법이 헷갈리면 커뮤니케이션 탭에 질문을 남겨 주세요. 사이트 소유자와 다른 운영자가 답변할 수 있습니다.',
  'owner',
  true,
  array[
    '/guides/operator/01-operator-home.png',
    '/guides/operator/02-product-registration.png',
    '/guides/operator/03-fulfillment.png',
    '/guides/operator/04-orders-winners.png'
  ],
  '2026-08-18 00:00:00+09',
  '2026-08-18 00:00:00+09'
)
on conflict (id) do nothing;

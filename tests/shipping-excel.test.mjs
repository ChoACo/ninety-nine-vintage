import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const rootUrl = new URL("../", import.meta.url);

async function loadShippingExcelModule() {
  const originalSource = await readFile(
    new URL("src/lib/shipping/excel.ts", rootUrl),
    "utf8",
  );
  const transpiled = ts.transpileModule(originalSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}#${Date.now()}`
  );
}

function trackingRow(overrides = {}) {
  return {
    rowNumber: 2,
    sequence: "1",
    trackingNumber: "123456789012",
    recipientName: "홍길동",
    phone: "010-1234-5678",
    managerName: "",
    mobile: "",
    postalCode: "06234",
    address: "서울 강남구 테헤란로 123 4층 401호",
    quantity: "1",
    senderName: "나인티 나인 빈티지",
    itemName: "의류",
    ...overrides,
  };
}

test("normalizes shipping snapshots and maps the exact A-P export layout", async () => {
  const {
    SHIPPING_EXPORT_HEADERS,
    buildShippingExportRow,
    normalizePostalCode,
    normalizeShippingAddressSnapshot,
  } = await loadShippingExcelModule();

  assert.equal(SHIPPING_EXPORT_HEADERS.length, 16);
  assert.equal(normalizePostalCode("6234"), "06234");
  const snapshot = {
    recipientName: " 홍길동 ",
    phone: "+82 10-1234-5678",
    address: "[06234] 서울 강남구 테헤란로 123 4층 401호",
    deliveryNote: "문 앞 보관 부탁드립니다",
  };
  assert.deepEqual(normalizeShippingAddressSnapshot(snapshot), {
    recipientName: "홍길동",
    phone: "010-1234-5678",
    postalCode: "06234",
    address: "서울 강남구 테헤란로 123 4층 401호",
    note: "문 앞 보관 부탁드립니다",
    paymentTerm: "",
  });

  assert.deepEqual(
    buildShippingExportRow({
      requestId: "request-1",
      addressSnapshot: snapshot,
      memos: ["옵션 없음", "사은품 포함"],
    }),
    [
      "홍길동",
      "",
      "",
      "010-1234-5678",
      "06234",
      "서울 강남구 테헤란로 123 4층 401호",
      1,
      "의류",
      "",
      "선불",
      "request-1",
      "문 앞 보관 부탁드립니다",
      "옵션 없음",
      "사은품 포함",
      "",
      "",
    ],
  );
});

test("accepts snake_case address snapshots and explicit postal codes", async () => {
  const {
    normalizePhoneForMatch,
    normalizePostalCode,
    normalizeShippingAddressSnapshot,
  } = await loadShippingExcelModule();
  assert.equal(normalizePhoneForMatch("1012345678"), "01012345678");
  assert.equal(normalizePostalCode("6234"), "06234");
  assert.deepEqual(
    normalizeShippingAddressSnapshot({
      recipient_name: "상호명",
      phone_number: "02 1234 5678",
      postal_code: "48242",
      full_address: "부산광역시 수영구 수미로50번길 37-1",
      payment_term: "착불",
    }),
    {
      recipientName: "상호명",
      phone: "02-1234-5678",
      postalCode: "48242",
      address: "부산광역시 수영구 수미로50번길 37-1",
      note: "",
      paymentTerm: "착불",
    },
  );
});

test("detects an A-K tracking header within the first ten rows and parses valid rows", async () => {
  const { detectTrackingHeaderRow, parseTrackingImportRows } =
    await loadShippingExcelModule();
  const rows = [
    { rowNumber: 1, cells: ["택배사 송장 결과"] },
    {
      rowNumber: 3,
      cells: [
        "순번",
        "운송장번호",
        "받는분",
        "받는분 전화번호",
        "받는분 담당자",
        "받는분 휴대폰번호",
        "받는분 우편번호",
        "받는분 주소",
        "수량",
        "보내는사람",
        "품목명",
      ],
    },
    {
      rowNumber: 4,
      cells: [
        1,
        { formula: "B4", result: 123456789012 },
        "홍길동",
        "010-1234-5678",
        "",
        "",
        "06234",
        "서울 강남구 테헤란로 123 4층 401호",
        1,
        "나인티 나인 빈티지",
        "의류",
      ],
    },
    { rowNumber: 5, cells: [2, "", "김회원", "010-9999-9999"] },
  ];

  const detected = detectTrackingHeaderRow(rows);
  assert.ok(detected);
  assert.equal(detected.headerRowNumber, 3);
  assert.deepEqual(detected.columns, {
    sequence: 0,
    trackingNumber: 1,
    recipientName: 2,
    phone: 3,
    managerName: 4,
    mobile: 5,
    postalCode: 6,
    address: 7,
    quantity: 8,
    senderName: 9,
    itemName: 10,
  });

  const parsed = parseTrackingImportRows(rows, detected);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].trackingNumber, "123456789012");
  assert.deepEqual(parsed.skippedRows, [
    { rowNumber: 5, reason: "운송장번호가 없습니다." },
  ]);
});

test("rejects a worksheet without recipient, tracking, and contact headers", async () => {
  const { detectTrackingHeaderRow, validateTrackingWorkbookFile } =
    await loadShippingExcelModule();
  assert.throws(
    () => validateTrackingWorkbookFile({ name: "tracking.xls", size: 1_024 }),
    /\.xlsx/,
  );
  assert.throws(
    () => validateTrackingWorkbookFile({ name: "tracking.xlsx", size: 11 * 1024 * 1024 }),
    /10MB/,
  );
  assert.equal(
    detectTrackingHeaderRow([
      { rowNumber: 1, cells: ["순번", "받는분", "주소"] },
      { rowNumber: 2, cells: [1, "홍길동", "서울"] },
    ]),
    null,
  );
});

test("matches only a unique recipient, primary phone, postal code, and address tuple", async () => {
  const { matchTrackingImportRows } = await loadShippingExcelModule();
  const candidates = [
    {
      requestId: "request-1",
      addressSnapshot: {
        recipientName: "홍길동",
        phone: "01012345678",
        address: "(06234) 서울 강남구 테헤란로 123 4층 401호",
      },
    },
    {
      requestId: "request-2",
      addressSnapshot: {
        recipientName: "김회원",
        phone: "01099999999",
        postalCode: "48242",
        address: "부산 수영구 수미로50번길 37-1",
      },
    },
  ];

  const result = matchTrackingImportRows(
    [
      trackingRow(),
      trackingRow({
        rowNumber: 3,
        recipientName: "김회원",
        phone: "010-0000-0000",
        mobile: "010-9999-9999",
        postalCode: "48242",
        address: "부산 수영구 수미로50번길 37-1",
      }),
      trackingRow({ rowNumber: 4, recipientName: "없는회원" }),
    ],
    candidates,
  );

  assert.deepEqual(result.matched.map((entry) => entry.requestId), [
    "request-1",
    "request-2",
  ]);
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.ambiguous.length, 0);
});

test("does not choose by row order when identical customer data is ambiguous", async () => {
  const { matchTrackingImportRows } = await loadShippingExcelModule();
  const addressSnapshot = {
    recipientName: "홍길동",
    phone: "01012345678",
    postalCode: "06234",
    address: "서울 강남구 테헤란로 123 4층 401호",
  };
  const result = matchTrackingImportRows([trackingRow()], [
    { requestId: "request-1", addressSnapshot },
    { requestId: "request-2", addressSnapshot },
  ]);

  assert.equal(result.matched.length, 0);
  assert.equal(result.unmatched.length, 0);
  assert.deepEqual(result.ambiguous[0].candidateRequestIds, ["request-1", "request-2"]);
});

test("rejects duplicate Excel rows that resolve to one shipping request", async () => {
  const { matchTrackingImportRows } = await loadShippingExcelModule();
  const candidates = [
    {
      requestId: "request-1",
      addressSnapshot: {
        recipientName: "홍길동",
        phone: "01012345678",
        postalCode: "06234",
        address: "서울 강남구 테헤란로 123 4층 401호",
      },
    },
  ];
  const result = matchTrackingImportRows(
    [trackingRow(), trackingRow({ rowNumber: 3, trackingNumber: "999999999999" })],
    candidates,
  );

  assert.equal(result.matched.length, 0);
  assert.equal(result.ambiguous.length, 2);
  assert.match(result.ambiguous[0].reason, /여러 행/);
});

test("persists editable tracking data through bounded staff RPCs", async () => {
  const [migration, operations, workbook, panel] = await Promise.all([
    readFile(
      new URL(
        "supabase/migrations/20260718073000_shipping_excel_tracking.sql",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(new URL("src/lib/supabase/operations.ts", rootUrl), "utf8"),
    readFile(new URL("src/lib/shipping/workbook.ts", rootUrl), "utf8"),
    readFile(
      new URL("src/components/admin/ShippingWorkPanel.tsx", rootUrl),
      "utf8",
    ),
  ]);

  assert.match(migration, /add column if not exists postal_code text/);
  assert.match(migration, /create or replace function public\.get_shipping_work/);
  assert.match(migration, /p_offset integer default 0/);
  assert.match(migration, /count\(\*\) over\s*\(\)/);
  assert.match(migration, /v_actor_role in \('owner', 'operator'\)/);
  assert.match(migration, /jsonb_array_length\(p_updates\) not between 1 and 500/);
  assert.match(migration, /create or replace function public\.upsert_shipping_tracking_batch/);
  assert.match(migration, /v_actor_role = 'employee' and v_request_status <> 'requested'/);
  assert.match(migration, /expected_updated_at/);
  assert.match(migration, /shipping_requests_unique_tracking_idx/);
  assert.match(migration, /shipped_at = coalesce\(requests\.shipped_at, clock_timestamp\(\)\)/);
  assert.match(operations, /export async function saveShippingTrackingBatch/);
  assert.match(operations, /export async function getShippingWorkPage/);
  assert.match(operations, /expected_updated_at: expectedUpdatedAt/);
  assert.match(workbook, /await import\("exceljs"\)/);
  assert.match(workbook, /worksheet\.addRow\(\[\.\.\.SHIPPING_EXPORT_HEADERS\]\)/);
  assert.match(panel, /현재 페이지 배송 대기 전체 선택/);
  assert.match(panel, /canAccessCompleted/);
  assert.match(panel, /운송장 수정/);
  assert.match(panel, /확정 등록/);
});

test("enforces postal codes for new member shipping mutations without rewriting legacy rows", async () => {
  const [migration, snapshotMigration] = await Promise.all([
    readFile(
      new URL(
        "supabase/migrations/20260718075000_require_member_shipping_postal_code.sql",
        rootUrl,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "supabase/migrations/20260718073000_shipping_excel_tracking.sql",
        rootUrl,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    migration,
    /create or replace function public\.enforce_member_shipping_address_postal_code\(\)[\s\S]*security definer[\s\S]*set search_path = ''/,
  );
  assert.match(
    migration,
    /create trigger shipping_addresses_validate_postal_code\s+before insert or update on public\.shipping_addresses/,
  );
  assert.match(
    migration,
    /v_postal_code !~ '\^\[0-9\]\{5\}\$'/,
  );
  assert.match(
    migration,
    /from public\.owner_hidden_test_members as hidden_test[\s\S]*hidden_test\.test_user_id = new\.member_id[\s\S]*hidden_test\.retired_at is null/,
  );
  assert.match(
    migration,
    /create or replace function public\.enforce_member_shipping_request_postal_code\(\)[\s\S]*security definer[\s\S]*set search_path = ''/,
  );
  assert.match(
    migration,
    /new\.address_snapshot ->> 'postalCode'/,
  );
  assert.match(
    migration,
    /create trigger shipping_requests_validate_postal_snapshot\s+before insert on public\.shipping_requests/,
  );
  assert.match(
    migration,
    /revoke all on function public\.enforce_member_shipping_address_postal_code\(\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /revoke all on function public\.enforce_member_shipping_request_postal_code\(\)[\s\S]*from public, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(migration, /update public\.shipping_addresses/);
  assert.doesNotMatch(migration, /update public\.shipping_requests/);
  assert.match(
    snapshotMigration,
    /create trigger shipping_requests_set_postal_snapshot\s+before insert on public\.shipping_requests/,
  );
  assert.ok(
    "shipping_requests_set_postal_snapshot" <
      "shipping_requests_validate_postal_snapshot",
  );
});

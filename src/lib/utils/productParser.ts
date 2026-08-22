const BRAND_ALIASES = [
  ["RALPH LAUREN", "POLO RALPH LAUREN"],
  ["랄프로렌", "POLO RALPH LAUREN"],
  ["NORTH FACE", "THE NORTH FACE"],
  ["노스페이스", "THE NORTH FACE"],
  ["UNDER ARMOUR", "UNDER ARMOUR"],
  ["언더아머", "UNDER ARMOUR"],
  ["PATAGONIA", "PATAGONIA"],
  ["파타고니아", "PATAGONIA"],
  ["CARHARTT", "CARHARTT"],
  ["칼하트", "CARHARTT"],
  ["CHAMPION", "CHAMPION"],
  ["챔피온", "CHAMPION"],
  ["BURBERRY", "BURBERRY"],
  ["버버리", "BURBERRY"],
  ["SUPREME", "SUPREME"],
  ["슈프림", "SUPREME"],
  ["STUSSY", "STUSSY"],
  ["스투시", "STUSSY"],
  ["DICKIES", "DICKIES"],
  ["디키즈", "DICKIES"],
  ["ADIDAS", "ADIDAS"],
  ["아디다스", "ADIDAS"],
  ["LEVI'S", "LEVI'S"],
  ["리바이스", "LEVI'S"],
  ["NIKE", "NIKE"],
  ["나이키", "NIKE"],
  ["POLO", "POLO RALPH LAUREN"],
  ["폴로", "POLO RALPH LAUREN"],
  ["루이까스텔", "LOUIS CASTEL"],
] as const;

const SIZE_PATTERN =
  /(?:^|\s)(XXS|XS|S|M|L|XL|2XL|3XL|FREE|90|95|100|105|110|[2-3][0-9]인치|[2-3][0-9])(?=\s|$)/iu;

export function parseBrandAndSizeFromTitle(title: string): {
  brand: string | null;
  size: string | null;
} {
  const normalized = title.normalize("NFKC").trim();
  if (!normalized) return { brand: null, size: null };
  const upperTitle = normalized.toLocaleUpperCase("en-US");
  const brand =
    BRAND_ALIASES.find(([alias]) =>
      upperTitle.includes(alias.toLocaleUpperCase("en-US")),
    )?.[1] ?? null;
  const size =
    normalized.match(SIZE_PATTERN)?.[1]?.toLocaleUpperCase("en-US") ?? null;
  return { brand, size };
}

export interface PublishSlot {
  label: string;
  value: string;
}

export function getAvailablePublishSlots(now = new Date()): PublishSlot[] {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const startOffsetDays = kstNow.getUTCHours() < 10 ? 0 : 1;
  const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

  return Array.from({ length: 7 }, (_, index) => {
    const offset = startOffsetDays + index;
    const targetKst = new Date(
      Date.UTC(
        kstNow.getUTCFullYear(),
        kstNow.getUTCMonth(),
        kstNow.getUTCDate() + offset,
        10,
      ),
    );
    const targetUtc = new Date(targetKst.getTime() - kstOffsetMs);
    const prefix =
      offset === 0
        ? "오늘"
        : offset === 1
          ? "내일"
          : `${targetKst.getUTCMonth() + 1}/${targetKst.getUTCDate()}(${dayNames[targetKst.getUTCDay()]})`;
    return {
      label: `${prefix} 오전 10:00 공개 (${targetKst.getUTCFullYear()}.${targetKst.getUTCMonth() + 1}.${targetKst.getUTCDate()})`,
      value: targetUtc.toISOString(),
    };
  });
}

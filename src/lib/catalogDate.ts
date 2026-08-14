const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function getKstDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function normalizeCatalogDate(value: string | undefined): string {
  if (!value || !DATE_PATTERN.test(value)) return getKstDateKey();
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? getKstDateKey()
    : value;
}

export function getKstDateRange(dateKey: string): { from: string; to: string } {
  const next = new Date(`${dateKey}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    from: `${dateKey}T00:00:00+09:00`,
    to: `${next.toISOString().slice(0, 10)}T00:00:00+09:00`,
  };
}

export function getRecentCatalogDates(days = 7): string[] {
  const today = getKstDateKey();
  const cursor = new Date(`${today}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  });
}

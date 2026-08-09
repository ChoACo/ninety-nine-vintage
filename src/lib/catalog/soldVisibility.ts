export function soldFeedVisibleAt(closesAt: string) {
  const closed = new Date(closesAt);
  if (Number.isNaN(closed.getTime())) return null;
  const kst = new Date(closed.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, 1));
}

export function isSoldFeedVisible(closesAt: string, now = new Date()) {
  const visibleAt = soldFeedVisibleAt(closesAt);
  return visibleAt !== null && visibleAt.getTime() <= now.getTime();
}

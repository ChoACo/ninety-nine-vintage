export function ownerSnapshotMatchesSession(
  loadedSessionRevision: number | null,
  sessionRevision: number,
  hasSession: boolean,
  sessionLoading: boolean,
): boolean {
  return (
    !sessionLoading &&
    hasSession &&
    loadedSessionRevision === sessionRevision
  );
}

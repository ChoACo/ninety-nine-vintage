let activeBodyScrollLocks = 0;
let initialBodyOverflow = "";

/**
 * Reference-counted body lock for nested route and action dialogs. Cleanup
 * order no longer matters when a portaled child and its route shell unmount in
 * the same navigation.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (activeBodyScrollLocks === 0) {
    initialBodyOverflow = document.body.style.overflow;
  }
  activeBodyScrollLocks += 1;
  document.body.style.overflow = "hidden";
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeBodyScrollLocks = Math.max(0, activeBodyScrollLocks - 1);
    if (activeBodyScrollLocks === 0) {
      document.body.style.overflow = initialBodyOverflow;
      initialBodyOverflow = "";
    }
  };
}

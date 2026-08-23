interface InitialScrollStyles {
  bodyOverflow: string;
  documentOverflow: string;
  documentOverscrollBehavior: string;
}

const activeBodyScrollLocks = new Set<symbol>();
let initialScrollStyles: InitialScrollStyles | null = null;

function restoreScrollStyles() {
  if (typeof document === "undefined") return;

  if (initialScrollStyles) {
    document.documentElement.style.overflow =
      initialScrollStyles.documentOverflow;
    document.documentElement.style.overscrollBehavior =
      initialScrollStyles.documentOverscrollBehavior;
    document.body.style.overflow = initialScrollStyles.bodyOverflow;
  } else {
    // BFCache restores can retain inline locks from an older document while
    // the module state starts clean. Only remove values owned by a scroll lock.
    if (document.documentElement.style.overflow === "hidden") {
      document.documentElement.style.removeProperty("overflow");
    }
    if (document.documentElement.style.overscrollBehavior === "none") {
      document.documentElement.style.removeProperty("overscroll-behavior");
    }
    if (document.body.style.overflow === "hidden") {
      document.body.style.removeProperty("overflow");
    }
  }

  delete document.documentElement.dataset.scrollLocked;
  initialScrollStyles = null;
}

/**
 * Reference-counted body lock for nested route and action dialogs. Cleanup
 * order no longer matters when a portaled child and its route shell unmount in
 * the same navigation.
 */
export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (activeBodyScrollLocks.size === 0) {
    initialScrollStyles = {
      bodyOverflow: document.body.style.overflow,
      documentOverflow: document.documentElement.style.overflow,
      documentOverscrollBehavior:
        document.documentElement.style.overscrollBehavior,
    };
  }

  const lockToken = Symbol("body-scroll-lock");
  activeBodyScrollLocks.add(lockToken);
  document.documentElement.dataset.scrollLocked = "true";
  document.documentElement.style.overflow = "hidden";
  document.documentElement.style.overscrollBehavior = "none";
  document.body.style.overflow = "hidden";
  let released = false;

  return () => {
    if (released) return;
    released = true;
    activeBodyScrollLocks.delete(lockToken);
    if (activeBodyScrollLocks.size === 0) restoreScrollStyles();
  };
}

/**
 * Clears a stranded lock after navigation or a BFCache restore. Callers must
 * first confirm that no modal or drawer remains open.
 */
export function recoverBodyScroll() {
  activeBodyScrollLocks.clear();
  restoreScrollStyles();
}

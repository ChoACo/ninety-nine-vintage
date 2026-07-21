export interface PanZoomTransform {
  scale: number;
  x: number;
  y: number;
}

export interface PanZoomBounds {
  contentHeight: number;
  contentWidth: number;
  maxScale?: number;
  minScale?: number;
  viewportHeight: number;
  viewportWidth: number;
}

export interface PanZoomPoint {
  x: number;
  y: number;
}

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export function fitContain(
  viewportWidth: number,
  viewportHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): { height: number; width: number } {
  const safeViewportWidth = Math.max(1, finiteOr(viewportWidth, 1));
  const safeViewportHeight = Math.max(1, finiteOr(viewportHeight, 1));
  const safeSourceWidth = finiteOr(sourceWidth, 0);
  const safeSourceHeight = finiteOr(sourceHeight, 0);
  if (
    safeSourceWidth <= 0 ||
    safeSourceHeight <= 0
  ) {
    return { height: safeViewportHeight, width: safeViewportWidth };
  }
  const ratio = Math.min(
    safeViewportWidth / safeSourceWidth,
    safeViewportHeight / safeSourceHeight,
  );
  return {
    height: safeSourceHeight * ratio,
    width: safeSourceWidth * ratio,
  };
}

export function clampTransform(
  transform: PanZoomTransform,
  bounds: PanZoomBounds,
): PanZoomTransform {
  const minScale = Math.max(0.1, finiteOr(bounds.minScale ?? 1, 1));
  const maxScale = Math.max(
    minScale,
    finiteOr(bounds.maxScale ?? 4, 4),
  );
  const contentWidth = Math.max(1, finiteOr(bounds.contentWidth, 1));
  const contentHeight = Math.max(1, finiteOr(bounds.contentHeight, 1));
  const viewportWidth = Math.max(1, finiteOr(bounds.viewportWidth, 1));
  const viewportHeight = Math.max(1, finiteOr(bounds.viewportHeight, 1));
  const scale = Math.min(
    maxScale,
    Math.max(minScale, finiteOr(transform.scale, minScale)),
  );
  const maxX = Math.max(
    0,
    (contentWidth * scale - viewportWidth) /
      2,
  );
  const maxY = Math.max(
    0,
    (contentHeight * scale - viewportHeight) /
      2,
  );
  return {
    scale,
    x: Math.min(maxX, Math.max(-maxX, finiteOr(transform.x, 0))),
    y: Math.min(maxY, Math.max(-maxY, finiteOr(transform.y, 0))),
  };
}

export function zoomAtPoint(
  transform: PanZoomTransform,
  nextScale: number,
  point: PanZoomPoint,
  bounds: PanZoomBounds,
): PanZoomTransform {
  const safeScale = Math.max(0.1, finiteOr(transform.scale, 1));
  const maxScale = Math.max(1, finiteOr(bounds.maxScale ?? 4, 4));
  const minScale = Math.max(0.1, finiteOr(bounds.minScale ?? 1, 1));
  const pointX = finiteOr(point.x, 0);
  const pointY = finiteOr(point.y, 0);
  const scale = Math.min(
    maxScale,
    Math.max(minScale, finiteOr(nextScale, safeScale)),
  );
  const localX = (pointX - finiteOr(transform.x, 0)) / safeScale;
  const localY = (pointY - finiteOr(transform.y, 0)) / safeScale;
  return clampTransform(
    {
      scale,
      x: pointX - localX * scale,
      y: pointY - localY * scale,
    },
    bounds,
  );
}

export function panBy(
  transform: PanZoomTransform,
  delta: PanZoomPoint,
  bounds: PanZoomBounds,
): PanZoomTransform {
  return clampTransform(
    {
      ...transform,
      x: transform.x + finiteOr(delta.x, 0),
      y: transform.y + finiteOr(delta.y, 0),
    },
    bounds,
  );
}

export function pinchTransform(
  initial: PanZoomTransform,
  initialCenter: PanZoomPoint,
  currentCenter: PanZoomPoint,
  distanceRatio: number,
  bounds: PanZoomBounds,
): PanZoomTransform {
  const ratio =
    Number.isFinite(distanceRatio) && distanceRatio > 0 ? distanceRatio : 1;
  const safeScale = Math.max(0.1, finiteOr(initial.scale, 1));
  const initialCenterX = finiteOr(initialCenter.x, 0);
  const initialCenterY = finiteOr(initialCenter.y, 0);
  const currentCenterX = finiteOr(currentCenter.x, initialCenterX);
  const currentCenterY = finiteOr(currentCenter.y, initialCenterY);
  const nextScale = safeScale * ratio;
  const localX = (initialCenterX - finiteOr(initial.x, 0)) / safeScale;
  const localY = (initialCenterY - finiteOr(initial.y, 0)) / safeScale;
  return clampTransform(
    {
      scale: nextScale,
      x: currentCenterX - localX * nextScale,
      y: currentCenterY - localY * nextScale,
    },
    bounds,
  );
}

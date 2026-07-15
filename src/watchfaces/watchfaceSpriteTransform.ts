export type WatchfaceSpriteResizeHandle = "nw" | "ne" | "se" | "sw";

export interface WatchfaceSpriteTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface WatchfaceSpriteRotationTransform {
  rotation: number;
  rotationDelta: number;
}

const MIN_SPRITE_SIZE = 8;

function handleSigns(handle: WatchfaceSpriteResizeHandle): { x: -1 | 1; y: -1 | 1 } {
  switch (handle) {
    case "nw":
      return { x: -1, y: -1 };
    case "ne":
      return { x: 1, y: -1 };
    case "se":
      return { x: 1, y: 1 };
    case "sw":
      return { x: -1, y: 1 };
  }
}

export function normalizeWatchfaceRotation(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/**
 * Applies a Figma-style corner resize to a centered, rotated sprite. The
 * opposite corner stays fixed while the sprite center follows the handle.
 */
export function resizeWatchfaceSprite(
  initial: WatchfaceSpriteTransform,
  handle: WatchfaceSpriteResizeHandle,
  pointerDx: number,
  pointerDy: number,
  preserveAspectRatio = false
): WatchfaceSpriteTransform {
  const signs = handleSigns(handle);
  const radians = (initial.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localDx = pointerDx * cosine + pointerDy * sine;
  const localDy = -pointerDx * sine + pointerDy * cosine;
  let width = Math.max(MIN_SPRITE_SIZE, initial.width + signs.x * localDx);
  let height = Math.max(MIN_SPRITE_SIZE, initial.height + signs.y * localDy);

  if (preserveAspectRatio) {
    const widthScale = width / initial.width;
    const heightScale = height / initial.height;
    const scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1)
      ? widthScale
      : heightScale;
    width = Math.max(MIN_SPRITE_SIZE, initial.width * scale);
    height = Math.max(MIN_SPRITE_SIZE, initial.height * scale);
  }

  const centerLocalX = (signs.x * (width - initial.width)) / 2;
  const centerLocalY = (signs.y * (height - initial.height)) / 2;
  return {
    x: initial.x + centerLocalX * cosine - centerLocalY * sine,
    y: initial.y + centerLocalX * sine + centerLocalY * cosine,
    width,
    height,
    rotation: initial.rotation
  };
}

/** Calculates the signed rotation change from two pointer locations. */
export function rotateWatchfaceSprite(
  initial: WatchfaceSpriteTransform,
  startPointer: { x: number; y: number },
  currentPointer: { x: number; y: number }
): WatchfaceSpriteRotationTransform {
  const startAngle = Math.atan2(startPointer.y - initial.y, startPointer.x - initial.x);
  const currentAngle = Math.atan2(currentPointer.y - initial.y, currentPointer.x - initial.x);
  let rotationDelta = ((currentAngle - startAngle) * 180) / Math.PI;
  if (rotationDelta > 180) rotationDelta -= 360;
  if (rotationDelta < -180) rotationDelta += 360;
  return {
    rotation: normalizeWatchfaceRotation(initial.rotation + rotationDelta),
    rotationDelta
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function readArucoOverlay(marker, visible = true) {
  if (!visible || !marker || typeof marker !== "object") return null;

  const frameWidth = finiteNumber(marker.frame_width);
  const frameHeight = finiteNumber(marker.frame_height);
  const markerId = finiteNumber(marker.marker_id);
  const box = marker.bounding_box;
  const left = finiteNumber(box?.left);
  const top = finiteNumber(box?.top);
  const width = finiteNumber(box?.width);
  const height = finiteNumber(box?.height);

  if (
    !frameWidth ||
    !frameHeight ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    markerId === null ||
    left === null ||
    top === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const normalizedLeft = clamp(left, 0, 1);
  const normalizedTop = clamp(top, 0, 1);
  const normalizedRight = clamp(left + width, normalizedLeft, 1);
  const normalizedBottom = clamp(top + height, normalizedTop, 1);
  const labelHeight = Math.max(18, frameHeight * 0.055);
  const labelWidth = Math.min(150, frameWidth * 0.3);
  const x = normalizedLeft * frameWidth;
  const y = normalizedTop * frameHeight;

  return {
    frameWidth,
    frameHeight,
    x,
    y,
    width: (normalizedRight - normalizedLeft) * frameWidth,
    height: (normalizedBottom - normalizedTop) * frameHeight,
    label: `ARUCO · ID ${Math.trunc(markerId)}`,
    labelX: clamp(x, 0, Math.max(0, frameWidth - labelWidth)),
    labelY:
      y >= labelHeight + 4
        ? y - labelHeight - 4
        : Math.min(frameHeight - labelHeight, y + 4),
    labelWidth,
    labelHeight,
  };
}

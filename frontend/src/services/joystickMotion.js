export const MOTION_SEND_INTERVAL_MS = 50;

export function shapeYawInput(value) {
  const axis = Number(value);
  if (!Number.isFinite(axis)) return 0;
  const clamped = Math.max(-1, Math.min(1, axis));
  return Number((Math.sign(clamped) * Math.min(1, Math.abs(clamped) * 1.55)).toFixed(3));
}

export function motionSendDelay(now, lastSentAt) {
  if (!lastSentAt) return 0;
  return Math.max(0, MOTION_SEND_INTERVAL_MS - (now - lastSentAt));
}

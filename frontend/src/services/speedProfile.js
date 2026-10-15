export const MAX_FORWARD_SPEED_MPS = 3.7;

export function speedGain(percent) {
  const selected = Number(percent);
  if (!Number.isFinite(selected) || selected < 0 || selected > 100) {
    throw new RangeError("Nível de velocidade inválido.");
  }
  return selected / 100;
}

export function forwardSpeedMps(percent) {
  return MAX_FORWARD_SPEED_MPS * speedGain(percent);
}

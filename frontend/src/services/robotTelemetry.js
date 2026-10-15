export const MOVEMENT_THRESHOLD_MPS = 0.03;

const ACTIVITY_LABELS = {
  charging: "CARREGANDO",
  moving: "ANDANDO",
  stopped: "PARADO",
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readCurrentSpeed(status = {}) {
  const reported = finiteNumber(status.current_speed_mps);
  const velocity = status.sport_state?.velocity;
  let measured = null;
  if (Array.isArray(velocity) && velocity.length >= 2) {
    const x = finiteNumber(velocity[0]);
    const y = finiteNumber(velocity[1]);
    if (x !== null && y !== null) measured = Math.hypot(x, y);
  }
  return Math.max(0, reported ?? 0, measured ?? 0);
}

export function readRobotActivity(status = {}) {
  if (status.charging) return { key: "charging", label: ACTIVITY_LABELS.charging };

  const speed = readCurrentSpeed(status);
  const reported = status.robot_activity_status;
  if (speed >= MOVEMENT_THRESHOLD_MPS || reported === "moving") {
    return { key: "moving", label: ACTIVITY_LABELS.moving };
  }
  return { key: "stopped", label: ACTIVITY_LABELS.stopped };
}

export function formatBatteryPercent(value) {
  const percent = finiteNumber(value);
  if (percent === null) return "--";
  return `${Math.round(Math.max(0, Math.min(100, percent)))}%`;
}

export function formatAutonomy(minutes, charging = false) {
  if (charging) return "CARREGANDO";
  const value = finiteNumber(minutes);
  if (value === null || value < 0) return "CALCULANDO";
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (!hours) return `${remainingMinutes} MIN`;
  return `${hours}H ${String(remainingMinutes).padStart(2, "0")}MIN`;
}

export function formatCurrentSpeed(value) {
  const speed = finiteNumber(value);
  return Math.max(0, speed ?? 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function readRobotTemperature(status = {}) {
  const temperature = finiteNumber(status.robot_temperature_c);
  const threshold = finiteNumber(status.robot_temperature_high_threshold_c) ?? 70;
  if (temperature === null) {
    return { label: "--°C", tone: "is-stopped" };
  }
  const high = status.robot_temperature_high === true || temperature >= threshold;
  return {
    label: `${Math.round(temperature)}°C`,
    tone: high ? "is-temperature-high" : "is-temperature-ok",
  };
}

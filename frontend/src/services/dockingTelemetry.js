const ACTIVE_LABELS = {
  enabling_safety: "PREPARANDO",
  enabling_control: "PREPARANDO",
  navigating: "RETORNANDO",
  adjusting: "AJUSTANDO",
  verifying_charge: "ENCAIXANDO",
  waiting_marker: "BUSCANDO TAG",
};

const ESTIMATED_FULL_CHARGE_MINUTES = 120;

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function readDockingPresentation(status = {}) {
  if (status.charging || status.docking_state === "charging") {
    return { label: "CARREGANDO", tone: "charging" };
  }
  if (status.docking_active) {
    return {
      label: ACTIVE_LABELS[status.docking_state] || "RETORNANDO",
      tone: "active",
    };
  }
  if (status.docking_state === "error") {
    return { label: "FALHA", tone: "error" };
  }
  if (status.docking_state === "ready_to_calibrate") {
    return { label: "CALIBRAR", tone: "warning" };
  }
  if (status.docking_station_calibrated) {
    return { label: "PRONTA", tone: "ready" };
  }
  return { label: "NÃO CALIBRADA", tone: "offline" };
}

export function chargingTimeRemainingLabel(status = {}) {
  if (!status.charging && status.docking_state !== "charging") return "";

  const batteryPercent = finiteNumber(status.battery_percent);
  if (batteryPercent !== null && batteryPercent >= 100) return "CARGA CONCLUÍDA";

  const reportedMinutes = [
    status.charging_remaining_minutes,
    status.charge_remaining_minutes,
    status.time_to_full_minutes,
  ]
    .map(finiteNumber)
    .find((value) => value !== null && value >= 0);

  const remainingMinutes = reportedMinutes ??
    (batteryPercent === null
      ? null
      : Math.ceil(
        (100 - Math.max(0, Math.min(100, batteryPercent))) *
          (ESTIMATED_FULL_CHARGE_MINUTES / 100),
      ));

  if (remainingMinutes === null) return "CALCULANDO...";
  if (remainingMinutes <= 0) return "CARGA CONCLUÍDA";

  const totalMinutes = Math.ceil(remainingMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} MIN`;
  if (!minutes) return `${hours}H`;
  return `${hours}H ${String(minutes).padStart(2, "0")}MIN`;
}

export function dockingDistanceLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) return "";
  return `${distance.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} M`;
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  chargingTimeRemainingLabel,
  dockingDistanceLabel,
  readDockingPresentation,
} from "./dockingTelemetry.js";

test("resume os estados da estação para a faixa operacional", () => {
  assert.equal(readDockingPresentation({}).label, "NÃO CALIBRADA");
  assert.equal(
    readDockingPresentation({ docking_station_calibrated: true }).label,
    "PRONTA",
  );
  assert.equal(
    readDockingPresentation({ docking_active: true, docking_state: "adjusting" })
      .label,
    "AJUSTANDO",
  );
  assert.equal(readDockingPresentation({ charging: true }).label, "CARREGANDO");
});

test("formata a distância restante em metros", () => {
  assert.equal(dockingDistanceLabel(1.234), "1,23 M");
  assert.equal(dockingDistanceLabel(null), "");
});

test("informa o tempo restante somente quando o robô está carregando na base", () => {
  assert.equal(chargingTimeRemainingLabel({ battery_percent: 50 }), "");
  assert.equal(
    chargingTimeRemainingLabel({ charging: true, battery_percent: 50 }),
    "1H",
  );
  assert.equal(
    chargingTimeRemainingLabel({
      docking_state: "charging",
      battery_percent: 45,
      charging_remaining_minutes: 37,
    }),
    "37 MIN",
  );
  assert.equal(
    chargingTimeRemainingLabel({ charging: true, battery_percent: 100 }),
    "CARGA CONCLUÍDA",
  );
  assert.equal(
    chargingTimeRemainingLabel({ charging: true, battery_percent: null }),
    "CALCULANDO...",
  );
});

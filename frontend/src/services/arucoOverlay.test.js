import assert from "node:assert/strict";
import test from "node:test";

import { readArucoOverlay } from "./arucoOverlay.js";

test("converte a caixa normalizada da tag para o plano do vídeo", () => {
  const overlay = readArucoOverlay({
    marker_id: 7,
    frame_width: 640,
    frame_height: 360,
    bounding_box: { left: 0.25, top: 0.2, width: 0.5, height: 0.4 },
  });

  assert.equal(overlay.x, 160);
  assert.equal(overlay.y, 72);
  assert.equal(overlay.width, 320);
  assert.ok(Math.abs(overlay.height - 144) < 0.000001);
  assert.equal(overlay.label, "ARUCO · ID 7");
});

test("não exibe telemetria incompleta, inválida ou fora de validade", () => {
  assert.equal(readArucoOverlay(null), null);
  assert.equal(readArucoOverlay({ marker_id: 7 }, true), null);
  assert.equal(
    readArucoOverlay(
      {
        marker_id: 7,
        frame_width: 640,
        frame_height: 360,
        bounding_box: { left: 0.2, top: 0.2, width: 0.2, height: 0.2 },
      },
      false,
    ),
    null,
  );
});

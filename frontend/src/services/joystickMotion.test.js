import assert from "node:assert/strict";
import test from "node:test";

import { motionSendDelay, shapeYawInput } from "./joystickMotion.js";

test("aumenta a resposta do giro sem ultrapassar o curso aceito pelo gateway", () => {
  assert.equal(shapeYawInput(0.5), 0.775);
  assert.equal(shapeYawInput(-0.8), -1);
  assert.equal(shapeYawInput(1), 1);
});

test("envia o primeiro movimento imediatamente e limita os seguintes a 20 Hz", () => {
  assert.equal(motionSendDelay(100, 0), 0);
  assert.equal(motionSendDelay(120, 100), 30);
  assert.equal(motionSendDelay(151, 100), 0);
});

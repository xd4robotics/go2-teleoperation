import assert from "node:assert/strict";
import test from "node:test";

import { forwardSpeedMps, speedGain } from "./speedProfile.js";

test("faz o percentual escrito corresponder linearmente ao limite nominal", () => {
  assert.equal(forwardSpeedMps(100), 3.7);
  assert.equal(forwardSpeedMps(50), 1.85);
  assert.ok(Math.abs(forwardSpeedMps(20) - 0.74) < 1e-12);
  assert.ok(Math.abs(speedGain(20) - 0.2) < 1e-12);
});

test("cada botão de 10% corresponde a uma velocidade exata", () => {
  const expected = new Map([
    [10, 0.37],
    [20, 0.74],
    [30, 1.11],
    [40, 1.48],
    [50, 1.85],
    [60, 2.22],
    [70, 2.59],
    [80, 2.96],
    [90, 3.33],
    [100, 3.70],
  ]);

  for (const [percent, speed] of expected) {
    assert.ok(Math.abs(forwardSpeedMps(percent) - speed) < 1e-12);
  }
});

test("rejeita níveis fora da faixa", () => {
  assert.throws(() => speedGain(-1), RangeError);
  assert.throws(() => speedGain(101), RangeError);
  assert.throws(() => speedGain(Number.NaN), RangeError);
});

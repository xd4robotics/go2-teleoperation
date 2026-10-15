import assert from "node:assert/strict";
import test from "node:test";

import {
  hidAxisBaselines,
  hidDeviceName,
  isLikelyHidController,
  readHidInputReport,
  readHidMotion,
} from "./hidGamepad.js";

function usage(page, id) {
  return (page << 16) | id;
}

function controllerDevice() {
  return {
    productName: "USB Generic Gamepad",
    vendorId: 0x1234,
    productId: 0xabcd,
    collections: [{
      usagePage: 1,
      usage: 5,
      children: [],
      inputReports: [{
        reportId: 0,
        items: [
          {
            reportSize: 8,
            reportCount: 4,
            logicalMinimum: 0,
            logicalMaximum: 255,
            usages: [usage(1, 0x30), usage(1, 0x31), usage(1, 0x33), usage(1, 0x34)],
            isRange: false,
            isConstant: false,
            isArray: false,
          },
          {
            reportSize: 4,
            reportCount: 1,
            logicalMinimum: 0,
            logicalMaximum: 7,
            usages: [usage(1, 0x39)],
            isRange: false,
            isConstant: false,
            isArray: false,
          },
          {
            reportSize: 1,
            reportCount: 4,
            logicalMinimum: 0,
            logicalMaximum: 1,
            usageMinimum: usage(9, 1),
            usageMaximum: usage(9, 4),
            isRange: true,
            isConstant: false,
            isArray: false,
          },
        ],
      }],
    }],
  };
}

test("identifica controles HID padrão e preserva o nome do produto", () => {
  const device = controllerDevice();
  assert.equal(isLikelyHidController(device), true);
  assert.equal(hidDeviceName(device), "USB Generic Gamepad (1234:abcd)");
});

test("decodifica eixos, hat e botões de um relatório HID genérico", () => {
  const device = controllerDevice();
  const input = readHidInputReport(
    device,
    0,
    new DataView(Uint8Array.from([128, 0, 255, 128, 0b1010_0001]).buffer),
  );

  assert.ok(Math.abs(input.axes.x) < 0.01);
  assert.equal(input.axes.y, -1);
  assert.equal(input.axes.rx, 1);
  assert.deepEqual(input.hat, { forward: 1, yaw: -1 });
  assert.deepEqual([...input.buttons], [2, 4]);
});

test("mapeia controle HID de dois eixos para frente e giro", () => {
  const input = {
    axes: { x: 1, y: -1 },
    hat: { forward: 0, yaw: 0 },
  };
  assert.deepEqual(readHidMotion(input), { forward: 1, lateral: 0, yaw: -1 });
});

test("neutraliza eixos auxiliares que repousam no extremo", () => {
  const input = {
    axes: { x: 0, y: 0, z: -1 },
    hat: { forward: 0, yaw: 0 },
  };
  const baselines = hidAxisBaselines(input);
  assert.deepEqual(readHidMotion(input, baselines), { forward: 0, lateral: 0, yaw: 0 });
});

test("não aprende um manche inclinado como posição neutra", () => {
  const input = {
    axes: { x: 1, y: -1, z: -1 },
    hat: { forward: 0, yaw: 0 },
  };
  assert.deepEqual(hidAxisBaselines(input), { x: 0, y: 0, z: -1 });
  assert.deepEqual(readHidMotion(input, hidAxisBaselines(input)), {
    forward: 1,
    lateral: 0,
    yaw: -1,
  });
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  firstConnectedGamepad,
  gamepadAxisBaselines,
  gamepadDisplayName,
  hasGamepadMotion,
  isGamepadButtonPressed,
  isGamepadChordActivated,
  readGamepadControls,
  readGamepadMotion,
  resolveGamepadLayout,
  shapeGamepadAxis,
} from "./gamepad.js";

const released = Object.freeze({ pressed: false, value: 0 });
const pressed = Object.freeze({ pressed: true, value: 1 });

function gamepad({
  id = "",
  mapping = "",
  axes = [0, 0, 0, 0],
  buttonCount = 17,
  pressedButtons = [],
} = {}) {
  const buttons = Array.from({ length: buttonCount }, () => released);
  for (const index of pressedButtons) buttons[index] = pressed;
  return { id, mapping, axes, buttons };
}

test("ignora deriva dentro da zona morta", () => {
  assert.equal(shapeGamepadAxis(0.1), 0);
  assert.equal(shapeGamepadAxis(-0.14), 0);
});

test("ignora objetos residuais de controles USB desconectados", () => {
  const disconnected = { ...gamepad({ id: "Antigo" }), connected: false };
  const connected = { ...gamepad({ id: "Atual" }), connected: true };

  assert.equal(firstConnectedGamepad([null, disconnected, connected]), connected);
  assert.equal(firstConnectedGamepad([disconnected, null]), null);
});

test("reconhece gatilho analógico antes do clique completo", () => {
  assert.equal(isGamepadButtonPressed([{ pressed: false, value: 0.3 }], 0), true);
  assert.equal(isGamepadButtonPressed([{ pressed: false, value: 0.2 }], 0), false);
});

test("reconhece combinação independentemente da ordem dos botões", () => {
  const controls = { leftTrigger: true, faceLeft: true };

  assert.equal(
    isGamepadChordActivated(
      controls,
      { leftTrigger: false, faceLeft: true },
      "leftTrigger",
      "faceLeft",
    ),
    true,
  );
  assert.equal(
    isGamepadChordActivated(
      controls,
      { leftTrigger: true, faceLeft: false },
      "leftTrigger",
      "faceLeft",
    ),
    true,
  );
  assert.equal(
    isGamepadChordActivated(
      controls,
      controls,
      "leftTrigger",
      "faceLeft",
    ),
    false,
  );
});

test("normaliza automaticamente layouts padrão e DirectInput genérico", () => {
  const standard = gamepad({ mapping: "standard", pressedButtons: [2, 6] });
  const generic = gamepad({ id: "Generic USB Joystick", pressedButtons: [0, 6] });

  assert.equal(resolveGamepadLayout(standard).kind, "standard");
  assert.equal(resolveGamepadLayout(generic).kind, "generic");
  assert.deepEqual(
    {
      faceLeft: readGamepadControls(standard).faceLeft,
      leftTrigger: readGamepadControls(standard).leftTrigger,
    },
    { faceLeft: true, leftTrigger: true },
  );
  assert.deepEqual(
    {
      faceLeft: readGamepadControls(generic).faceLeft,
      leftTrigger: readGamepadControls(generic).leftTrigger,
    },
    { faceLeft: true, leftTrigger: true },
  );
});

test("usa ombro e botão central alternativos em controles simples", () => {
  const simpleTrigger = gamepad({ buttonCount: 6, pressedButtons: [4] });
  const simpleStart = gamepad({ buttonCount: 9, pressedButtons: [8] });

  assert.equal(resolveGamepadLayout(simpleTrigger).buttons.leftTrigger, 4);
  assert.equal(readGamepadControls(simpleTrigger).leftTrigger, true);
  assert.equal(resolveGamepadLayout(simpleStart).buttons.start, 8);
  assert.equal(readGamepadControls(simpleStart).start, true);
});

test("mantém curso total e resposta progressiva", () => {
  assert.equal(shapeGamepadAxis(1), 1);
  assert.equal(shapeGamepadAxis(-1), -1);
  assert.ok(shapeGamepadAxis(0.5) > 0);
  assert.ok(shapeGamepadAxis(0.5) < 0.5);
});

test("mapeia os manches no mesmo sistema de coordenadas do RC Unitree", () => {
  const vector = readGamepadMotion({ axes: [-1, -1, 1, 0] });

  assert.deepEqual(vector, { forward: 1, lateral: 1, yaw: -1 });
  assert.equal(hasGamepadMotion(vector), true);
  assert.equal(hasGamepadMotion({ forward: 0, lateral: 0, yaw: 0 }), false);
});

test("centraliza automaticamente eixos brutos que não repousam em zero", () => {
  const rawController = gamepad({ axes: [0, 0, -1, 0] });
  const layout = resolveGamepadLayout(rawController);
  const controls = readGamepadControls(rawController, layout);
  const baselines = gamepadAxisBaselines(rawController);

  assert.deepEqual(
    readGamepadMotion(rawController, layout, controls, baselines),
    { forward: 0, lateral: 0, yaw: 0 },
  );
  assert.deepEqual(baselines, [0, 0, -1, 0]);
});

test("não transforma o gatilho DirectInput em giro do robô", () => {
  const triggerPressed = gamepad({
    axes: [0, 0, 1, 0],
    pressedButtons: [6],
  });
  const layout = resolveGamepadLayout(triggerPressed);
  const controls = readGamepadControls(triggerPressed, layout);

  assert.deepEqual(
    readGamepadMotion(triggerPressed, layout, controls, [0, 0, -1, 0]),
    { forward: 0, lateral: 0, yaw: 0 },
  );
});

test("aceita direcional digital padrão e direcional por eixos genéricos", () => {
  const standardDpad = gamepad({
    mapping: "standard",
    pressedButtons: [12, 14],
  });
  const genericDpad = gamepad({
    axes: [1, -1],
  });

  assert.deepEqual(readGamepadMotion(standardDpad), {
    forward: 1,
    lateral: 0,
    yaw: 1,
  });
  assert.deepEqual(readGamepadMotion(genericDpad), {
    forward: 1,
    lateral: 0,
    yaw: -1,
  });
});

test("identifica controles comuns", () => {
  assert.equal(gamepadDisplayName("DualSense Wireless Controller"), "Controle PS5");
  assert.equal(gamepadDisplayName("DualShock 4"), "Controle PS4");
  assert.equal(gamepadDisplayName("Xbox 360 Controller (XInput)"), "Controle Xbox");
  assert.equal(gamepadDisplayName("Nintendo Switch Pro Controller"), "Controle Nintendo Switch");
  assert.equal(gamepadDisplayName("8BitDo Ultimate"), "Controle 8BitDo");
  assert.equal(gamepadDisplayName("Logitech F310"), "Controle Logitech");
});

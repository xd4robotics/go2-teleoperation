export const GAMEPAD_DEAD_ZONE = 0.14;
export const GAMEPAD_BUTTON_THRESHOLD = 0.25;

const STANDARD_BUTTONS = Object.freeze({
  faceBottom: 0,
  faceRight: 1,
  faceLeft: 2,
  faceTop: 3,
  leftTrigger: 6,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
});

// Controles DirectInput/genéricos normalmente expõem os quatro botões da
// face na ordem esquerda, inferior, direita e superior. O navegador converte
// automaticamente PS/Xbox/Switch conhecidos para STANDARD_BUTTONS.
const GENERIC_BUTTONS = Object.freeze({
  faceLeft: 0,
  faceBottom: 1,
  faceRight: 2,
  faceTop: 3,
  leftTrigger: 6,
  start: 9,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
});

const KNOWN_STANDARD_ID = /(?:xbox|xinput|dualsense|dualshock|wireless controller|054c[-:]|045e[-:]|switch pro)/i;

function rawAxis(gamepad, index) {
  if (!Number.isInteger(index)) return 0;
  const value = Number(gamepad?.axes?.[index] || 0);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function centeredAxis(gamepad, index, baselines) {
  const value = rawAxis(gamepad, index);
  if (!Number.isInteger(index) || !Array.isArray(baselines)) return value;
  const baseline = Number(baselines[index]);
  if (!Number.isFinite(baseline)) return value;
  const distance = value - baseline;
  const availableRange = distance >= 0 ? 1 - baseline : 1 + baseline;
  if (availableRange <= 0.001) return 0;
  return Math.max(-1, Math.min(1, distance / availableRange));
}

export function shapeGamepadAxis(value, deadZone = GAMEPAD_DEAD_ZONE) {
  const magnitude = Math.abs(Number(value) || 0);
  if (magnitude <= deadZone) return 0;
  const normalized = Math.min(1, (magnitude - deadZone) / (1 - deadZone));
  const progressive = normalized * (0.35 + 0.65 * normalized * normalized);
  return Math.sign(value) * progressive;
}

export function gamepadAxisBaselines(gamepad) {
  return Array.from(gamepad?.axes || [], (rawValue, index) => {
    const value = Number(rawValue);
    // Manches e direcionais repousam no centro. Eixos adicionais em -1/+1
    // normalmente são gatilhos DirectInput e precisam ser recentralizados.
    if (index < 2 || !Number.isFinite(value) || Math.abs(value) < 0.9) return 0;
    return Math.max(-1, Math.min(1, value));
  });
}

function availableButton(gamepad, preferred, fallback = null) {
  if (preferred < (gamepad?.buttons?.length || 0)) return preferred;
  if (fallback !== null && fallback < (gamepad?.buttons?.length || 0)) {
    return fallback;
  }
  return null;
}

export function resolveGamepadLayout(gamepad) {
  const browserMapped = gamepad?.mapping === "standard";
  const knownConsoleLayout = KNOWN_STANDARD_ID.test(gamepad?.id || "");
  const standardControls = browserMapped || knownConsoleLayout;
  const source = standardControls ? STANDARD_BUTTONS : GENERIC_BUTTONS;
  const buttons = { ...source };
  const simpleDirectional = !standardControls && (gamepad?.axes?.length || 0) <= 2;

  // Modelos simples podem não ter gatilhos dedicados ou dois botões centrais.
  buttons.leftTrigger = availableButton(gamepad, source.leftTrigger, 4);
  buttons.start = availableButton(gamepad, source.start, 8);
  for (const control of ["dpadUp", "dpadDown", "dpadLeft", "dpadRight"]) {
    buttons[control] = availableButton(gamepad, source[control]);
  }

  return {
    kind: browserMapped ? "standard" : standardControls ? "console" : "generic",
    buttons,
    axes: {
      // Em controles genéricos só com direcional, o eixo horizontal gira o
      // robô. Nos controles com dois manches, ele mantém o deslocamento lateral.
      leftX: simpleDirectional ? null : 0,
      leftY: 1,
      rightX: simpleDirectional ? 0 : 2,
    },
  };
}

export function readGamepadControls(gamepad, layout = resolveGamepadLayout(gamepad)) {
  return Object.fromEntries(
    Object.entries(layout.buttons).map(([control, index]) => [
      control,
      index !== null && isGamepadButtonPressed(gamepad?.buttons, index),
    ]),
  );
}

export function readGamepadMotion(
  gamepad,
  layout = resolveGamepadLayout(gamepad),
  controls = readGamepadControls(gamepad, layout),
  axisBaselines = null,
) {
  let forward = shapeGamepadAxis(
    -centeredAxis(gamepad, layout.axes.leftY, axisBaselines),
  );
  const lateral = shapeGamepadAxis(
    -centeredAxis(gamepad, layout.axes.leftX, axisBaselines),
  );
  let yaw = shapeGamepadAxis(
    -centeredAxis(gamepad, layout.axes.rightX, axisBaselines),
  );
  if (layout.kind === "generic" && controls.leftTrigger) yaw = 0;

  let digitalForward = Number(controls.dpadUp) - Number(controls.dpadDown);
  let digitalYaw = Number(controls.dpadLeft) - Number(controls.dpadRight);

  if (!forward && digitalForward) forward = digitalForward;
  if (!yaw && digitalYaw) yaw = digitalYaw;

  return {
    // O sistema de coordenadas nativo do Go2 usa +x para frente,
    // +y para a esquerda e +yaw no sentido anti-horário.
    forward,
    lateral,
    yaw,
  };
}

export function hasGamepadMotion(vector) {
  return [vector.forward, vector.lateral, vector.yaw]
    .some((value) => Math.abs(value) > 0.0001);
}

export function firstConnectedGamepad(gamepads) {
  return Array.from(gamepads || [])
    .find((gamepad) => gamepad && gamepad.connected !== false) || null;
}

export function isGamepadButtonPressed(buttons, index) {
  const button = buttons?.[index];
  return Boolean(button?.pressed || button?.value > GAMEPAD_BUTTON_THRESHOLD);
}

export function isGamepadChordActivated(
  controls,
  previousControls,
  modifier,
  action,
) {
  const modifierPressed = Boolean(controls?.[modifier]);
  const actionPressed = Boolean(controls?.[action]);
  const chordWasPressed = Boolean(previousControls?.[modifier] && previousControls?.[action]);
  return modifierPressed && actionPressed && !chordWasPressed;
}

export function gamepadDisplayName(id = "") {
  const normalized = id.toLowerCase();
  if (normalized.includes("dualsense") || normalized.includes("054c-0ce6")) {
    return "Controle PS5";
  }
  if (normalized.includes("dualshock") || normalized.includes("054c-05c4")) {
    return "Controle PS4";
  }
  if (normalized.includes("xbox") || normalized.includes("xinput")) {
    return "Controle Xbox";
  }
  if (normalized.includes("switch pro")) return "Controle Nintendo Switch";
  if (normalized.includes("8bitdo")) return "Controle 8BitDo";
  if (normalized.includes("logitech")) return "Controle Logitech";
  return id ? "Controle USB" : "Gamepad";
}

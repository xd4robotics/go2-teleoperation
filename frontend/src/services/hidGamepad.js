import { hasGamepadMotion, shapeGamepadAxis } from "./gamepad.js";

const USAGE_PAGE_GENERIC_DESKTOP = 0x01;
const USAGE_PAGE_BUTTON = 0x09;

const CONTROLLER_USAGES = new Set([0x04, 0x05, 0x08]);
const AXIS_NAMES = Object.freeze({
  0x30: "x",
  0x31: "y",
  0x32: "z",
  0x33: "rx",
  0x34: "ry",
  0x35: "rz",
  0x36: "slider",
  0x37: "dial",
  0x38: "wheel",
});
const HAT_SWITCH_USAGE = 0x39;

function collectionsOf(device) {
  const result = [];

  function append(collections = []) {
    for (const collection of collections) {
      result.push(collection);
      append(collection.children);
    }
  }

  append(device?.collections);
  return result;
}

function usageParts(usage) {
  const value = Number(usage) >>> 0;
  return {
    page: value >>> 16,
    id: value & 0xffff,
  };
}

function usageForField(item, index) {
  if (item.isRange) {
    const minimum = Number(item.usageMinimum) >>> 0;
    const maximum = Number(item.usageMaximum) >>> 0;
    return Math.min(minimum + index, maximum);
  }
  const usages = Array.from(item.usages || []);
  return Number(usages[index] ?? usages.at(-1) ?? 0) >>> 0;
}

function reportBitLength(report) {
  return Array.from(report?.items || []).reduce(
    (total, item) => total + Number(item.reportSize || 0) * Number(item.reportCount || 0),
    0,
  );
}

function reportFor(device, reportId) {
  const candidates = collectionsOf(device)
    .flatMap((collection) => collection.inputReports || [])
    .filter((report) => Number(report.reportId || 0) === Number(reportId || 0));
  return candidates.sort((first, second) => reportBitLength(second) - reportBitLength(first))[0] || null;
}

function readBits(data, bitOffset, bitSize, signed = false) {
  if (!data || bitSize <= 0 || bitSize > 32) return 0;
  let value = 0;
  for (let bit = 0; bit < bitSize; bit += 1) {
    const sourceBit = bitOffset + bit;
    const byteIndex = Math.floor(sourceBit / 8);
    if (byteIndex >= data.byteLength) break;
    const enabled = (data.getUint8(byteIndex) >> (sourceBit % 8)) & 1;
    if (enabled) value += 2 ** bit;
  }
  if (signed && value >= 2 ** (bitSize - 1)) value -= 2 ** bitSize;
  return value;
}

function normalizedAxis(value, minimum, maximum) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return 0;
  const normalized = ((value - minimum) / (maximum - minimum)) * 2 - 1;
  return Math.max(-1, Math.min(1, normalized));
}

function hatDirection(value, minimum, maximum) {
  const index = value - minimum;
  if (value < minimum || value > maximum || index < 0 || index > 7) {
    return { forward: 0, yaw: 0 };
  }
  const directions = [
    { forward: 1, yaw: 0 },
    { forward: 1, yaw: -1 },
    { forward: 0, yaw: -1 },
    { forward: -1, yaw: -1 },
    { forward: -1, yaw: 0 },
    { forward: -1, yaw: 1 },
    { forward: 0, yaw: 1 },
    { forward: 1, yaw: 1 },
  ];
  return directions[index];
}

export function isLikelyHidController(device) {
  return collectionsOf(device).some((collection) => {
    if (
      Number(collection.usagePage) === USAGE_PAGE_GENERIC_DESKTOP &&
      CONTROLLER_USAGES.has(Number(collection.usage))
    ) return true;

    return Array.from(collection.inputReports || []).some((report) =>
      Array.from(report.items || []).some((item) => {
        const usages = item.isRange
          ? [item.usageMinimum, item.usageMaximum]
          : item.usages;
        return Array.from(usages || []).some((usage) => {
          const { page, id } = usageParts(usage);
          return page === USAGE_PAGE_BUTTON ||
            (page === USAGE_PAGE_GENERIC_DESKTOP && (AXIS_NAMES[id] || id === HAT_SWITCH_USAGE));
        });
      }),
    );
  });
}

export function hidDeviceName(device) {
  const name = String(device?.productName || "").trim();
  const vendor = Number(device?.vendorId || 0).toString(16).padStart(4, "0");
  const product = Number(device?.productId || 0).toString(16).padStart(4, "0");
  const identifier = `${vendor}:${product}`;
  return name ? `${name} (${identifier})` : `Controle HID ${identifier}`;
}

export function readHidInputReport(device, reportId, data) {
  const report = reportFor(device, reportId);
  if (!report) return null;

  const axes = {};
  const buttons = new Set();
  let hat = { forward: 0, yaw: 0 };
  let hatAvailable = false;
  let bitOffset = 0;

  for (const item of report.items || []) {
    const bitSize = Number(item.reportSize || 0);
    const count = Number(item.reportCount || 0);
    const minimum = Number(item.logicalMinimum ?? 0);
    const maximum = Number(item.logicalMaximum ?? (2 ** bitSize) - 1);
    for (let index = 0; index < count; index += 1) {
      const value = readBits(data, bitOffset, bitSize, minimum < 0);
      const usage = usageParts(usageForField(item, index));
      bitOffset += bitSize;
      if (item.isConstant) continue;

      if (usage.page === USAGE_PAGE_GENERIC_DESKTOP && AXIS_NAMES[usage.id]) {
        axes[AXIS_NAMES[usage.id]] = normalizedAxis(value, minimum, maximum);
      } else if (
        usage.page === USAGE_PAGE_GENERIC_DESKTOP &&
        usage.id === HAT_SWITCH_USAGE
      ) {
        hatAvailable = true;
        hat = hatDirection(value, minimum, maximum);
      } else if (usage.page === USAGE_PAGE_BUTTON) {
        if (item.isArray) {
          if (value >= minimum && value <= maximum && value !== 0) buttons.add(value);
        } else if (value !== 0) {
          buttons.add(usage.id);
        }
      }
    }
  }

  return { axes, buttons, hat, hatAvailable };
}

export function hidAxisBaselines(input) {
  return Object.fromEntries(
    Object.entries(input?.axes || {}).map(([axis, value]) => [
      axis,
      // X/Y e Rx/Ry são manches: uma primeira leitura inclinada nunca pode
      // virar o novo centro. Eixos auxiliares em -1/+1 normalmente são
      // gatilhos DirectInput e podem usar o extremo de repouso como baseline.
      ["x", "y", "rx", "ry"].includes(axis)
        ? Math.abs(value) < 0.2 ? value : 0
        : Math.abs(value) < 0.2 || Math.abs(value) > 0.85 ? value : 0,
    ]),
  );
}

function centeredAxis(value = 0, baseline = 0) {
  const distance = value - baseline;
  const availableRange = distance >= 0 ? 1 - baseline : 1 + baseline;
  if (availableRange <= 0.001) return 0;
  return Math.max(-1, Math.min(1, distance / availableRange));
}

export function readHidMotion(input, baselines = {}) {
  if (!input) return { forward: 0, lateral: 0, yaw: 0 };
  const axes = input.axes || {};
  const x = shapeGamepadAxis(centeredAxis(axes.x, baselines.x));
  const y = shapeGamepadAxis(centeredAxis(axes.y, baselines.y));
  const rightAxisName = ["rx", "z", "rz", "slider", "dial", "wheel"]
    .find((axis) => axis in axes && Math.abs(baselines[axis] || 0) < 0.8);
  const rightX = rightAxisName
    ? shapeGamepadAxis(centeredAxis(axes[rightAxisName], baselines[rightAxisName]))
    : 0;

  let forward = -y;
  let lateral = rightAxisName ? -x : 0;
  let yaw = rightAxisName ? -rightX : -x;
  if (!forward && input.hat?.forward) forward = input.hat.forward;
  if (!yaw && input.hat?.yaw) yaw = input.hat.yaw;

  const vector = { forward, lateral, yaw };
  return hasGamepadMotion(vector) ? vector : { forward: 0, lateral: 0, yaw: 0 };
}

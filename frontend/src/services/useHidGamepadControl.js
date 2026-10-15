import { useCallback, useEffect, useRef, useState } from "react";

import { hasGamepadMotion } from "./gamepad";
import {
  hidAxisBaselines,
  hidDeviceName,
  isLikelyHidController,
  readHidInputReport,
  readHidMotion,
} from "./hidGamepad";

const INITIAL_STATE = {
  supported: false,
  secureContext: true,
  connected: false,
  name: "",
  compatible: false,
  requesting: false,
  motionDetected: false,
  waitingForNeutral: false,
  error: "",
};

function initialState() {
  return {
    ...INITIAL_STATE,
    supported: "hid" in navigator,
    secureContext: window.isSecureContext,
  };
}

function errorMessage(error) {
  if (error?.name === "NotFoundError") return "Nenhum dispositivo foi selecionado.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "O navegador não autorizou o acesso ao controle.";
  }
  if (error?.name === "NetworkError") {
    return "O sistema bloqueou o acesso a este controle.";
  }
  return error?.message || "Não foi possível abrir o controle.";
}

export function useHidGamepadControl({ enabled, canMove, onMotion, onStop }) {
  const [state, setState] = useState(initialState);
  const callbacksRef = useRef({ enabled, canMove, onMotion, onStop });
  const connectDeviceRef = useRef(null);

  useEffect(() => {
    callbacksRef.current = { enabled, canMove, onMotion, onStop };
  }, [canMove, enabled, onMotion, onStop]);

  const requestDevice = useCallback(async () => {
    if (!("hid" in navigator) || !window.isSecureContext) return null;
    setState((current) => ({ ...current, requesting: true, error: "" }));
    try {
      const devices = await navigator.hid.requestDevice({ filters: [] });
      const device = devices.find(isLikelyHidController) || devices[0] || null;
      if (!device) {
        setState((current) => ({
          ...current,
          requesting: false,
          error: "Nenhum dispositivo foi selecionado.",
        }));
        return null;
      }
      await connectDeviceRef.current?.(device);
      return device;
    } catch (error) {
      setState((current) => ({
        ...current,
        requesting: false,
        error: errorMessage(error),
      }));
      return null;
    }
  }, []);

  useEffect(() => {
    if (!("hid" in navigator) || !window.isSecureContext) return undefined;

    let active = true;
    let activeDevice = null;
    let isMoving = false;
    let pageActive = !document.hidden && document.hasFocus();
    let inputEnabled = false;
    let movementSuppressed = false;
    let baselines = null;

    function stopHidMotion() {
      if (!isMoving) return;
      isMoving = false;
      callbacksRef.current.onStop();
    }

    function publishDisconnected(error = "") {
      setState({
        ...INITIAL_STATE,
        supported: true,
        secureContext: true,
        error,
      });
    }

    function detachDevice(device) {
      device?.removeEventListener("inputreport", handleInputReport);
    }

    function handleInputReport(event) {
      if (!active || event.device !== activeDevice) return;
      const input = readHidInputReport(event.device, event.reportId, event.data);
      const compatible = Boolean(
        input && (Object.keys(input.axes || {}).length || input.hatAvailable),
      );
      if (!compatible) {
        inputEnabled = false;
        stopHidMotion();
        setState((current) => ({
          ...current,
          compatible: false,
          motionDetected: false,
          waitingForNeutral: false,
          error: "Controle identificado, mas o formato de movimento é proprietário.",
        }));
        return;
      }

      if (!baselines) baselines = hidAxisBaselines(input);
      const vector = readHidMotion(input, baselines);
      const hasMotion = hasGamepadMotion(vector);
      const inputAllowed = callbacksRef.current.enabled && pageActive;

      if (!inputAllowed) {
        inputEnabled = false;
        movementSuppressed = true;
        stopHidMotion();
        setState((current) => ({
          ...current,
          compatible: true,
          motionDetected: false,
          waitingForNeutral: false,
          error: "",
        }));
        return;
      }

      if (!inputEnabled) {
        inputEnabled = true;
        movementSuppressed = hasMotion;
        stopHidMotion();
        setState((current) => ({
          ...current,
          compatible: true,
          motionDetected: hasMotion,
          waitingForNeutral: hasMotion,
          error: "",
        }));
        return;
      }

      if (!hasMotion) movementSuppressed = false;
      setState((current) => ({
        ...current,
        compatible: true,
        motionDetected: hasMotion,
        waitingForNeutral: movementSuppressed && hasMotion,
        error: "",
      }));
      if (!movementSuppressed && hasMotion && callbacksRef.current.canMove) {
        isMoving = true;
        callbacksRef.current.onMotion(vector);
      } else {
        stopHidMotion();
      }
    }

    async function openDevice(device) {
      if (!active || !device) return;
      if (activeDevice && activeDevice !== device) {
        detachDevice(activeDevice);
        if (activeDevice.opened) await activeDevice.close().catch(() => {});
      }
      try {
        if (!device.opened) await device.open();
        if (!active) return;
        activeDevice = device;
        inputEnabled = false;
        movementSuppressed = false;
        baselines = null;
        device.addEventListener("inputreport", handleInputReport);
        setState({
          ...INITIAL_STATE,
          supported: true,
          secureContext: true,
          connected: true,
          name: hidDeviceName(device),
          requesting: false,
        });
      } catch (error) {
        if (active) publishDisconnected(errorMessage(error));
      }
    }

    connectDeviceRef.current = openDevice;

    function handleConnect(event) {
      if (!activeDevice) openDevice(event.device);
    }

    function handleDisconnect(event) {
      if (event.device !== activeDevice) return;
      detachDevice(activeDevice);
      activeDevice = null;
      baselines = null;
      inputEnabled = false;
      stopHidMotion();
      publishDisconnected();
    }

    function handleBlur() {
      pageActive = false;
      inputEnabled = false;
      stopHidMotion();
    }

    function handleFocus() {
      pageActive = !document.hidden;
    }

    function handleVisibility() {
      pageActive = !document.hidden && document.hasFocus();
      if (!pageActive) {
        inputEnabled = false;
        stopHidMotion();
      }
    }

    navigator.hid.addEventListener("connect", handleConnect);
    navigator.hid.addEventListener("disconnect", handleDisconnect);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    navigator.hid.getDevices()
      .then((devices) => {
        if (!active || activeDevice) return;
        const device = devices.find(isLikelyHidController) || devices[0];
        if (device) openDevice(device);
      })
      .catch((error) => {
        if (active) publishDisconnected(errorMessage(error));
      });

    return () => {
      active = false;
      connectDeviceRef.current = null;
      navigator.hid.removeEventListener("connect", handleConnect);
      navigator.hid.removeEventListener("disconnect", handleDisconnect);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      detachDevice(activeDevice);
      stopHidMotion();
      if (activeDevice?.opened) activeDevice.close().catch(() => {});
    };
  }, []);

  return { ...state, requestDevice };
}

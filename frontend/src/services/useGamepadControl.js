import { useEffect, useRef, useState } from "react";

import {
  firstConnectedGamepad,
  gamepadAxisBaselines,
  gamepadDisplayName,
  hasGamepadMotion,
  isGamepadChordActivated,
  readGamepadControls,
  readGamepadMotion,
  resolveGamepadLayout,
} from "./gamepad";

const STANDALONE_BUTTON_GRACE_MS = 250;

const INITIAL_STATE = {
  supported: true,
  secureContext: true,
  connected: false,
  name: "",
  standardMapping: false,
  motionDetected: false,
  waitingForNeutral: false,
};

function initialState() {
  return {
    ...INITIAL_STATE,
    supported: typeof navigator.getGamepads === "function",
    secureContext: window.isSecureContext,
  };
}

function sameState(first, second) {
  return Object.keys(INITIAL_STATE).every((key) => first[key] === second[key]);
}

export function useGamepadControl({
  enabled = true,
  canMove,
  onMotion,
  onStop,
  onAction,
}) {
  const [state, setState] = useState(initialState);
  const callbacksRef = useRef({ enabled, canMove, onMotion, onStop, onAction });

  useEffect(() => {
    callbacksRef.current = { enabled, canMove, onMotion, onStop, onAction };
  }, [canMove, enabled, onAction, onMotion, onStop]);

  useEffect(() => {
    const supported = typeof navigator.getGamepads === "function";
    const secureContext = window.isSecureContext;
    if (!supported || !secureContext) return undefined;

    let animationFrame = null;
    let activeIndex = null;
    let isMoving = false;
    let previousControls = {};
    let axisBaselines = [];
    let avoidanceOffStartedAt = null;
    let avoidanceOffSent = false;
    let avoidanceOnStartedAt = null;
    let avoidanceOnSent = false;
    let pageActive = !document.hidden && document.hasFocus();
    let movementSuppressed = false;
    let inputEnabled = false;
    let publishedMotionDetected = false;
    let publishedWaitingForNeutral = false;

    function publishState(gamepad) {
      publishedMotionDetected = false;
      publishedWaitingForNeutral = false;
      const nextState = gamepad
        ? {
            ...INITIAL_STATE,
            supported: true,
            secureContext: true,
            connected: true,
            name: gamepadDisplayName(gamepad.id),
            standardMapping: gamepad.mapping === "standard",
          }
        : INITIAL_STATE;
      setState((current) => sameState(current, nextState) ? current : nextState);
    }

    function publishInputState(motionDetected, waitingForNeutral) {
      if (
        motionDetected === publishedMotionDetected &&
        waitingForNeutral === publishedWaitingForNeutral
      ) return;
      publishedMotionDetected = motionDetected;
      publishedWaitingForNeutral = waitingForNeutral;
      setState((current) => ({
        ...current,
        motionDetected,
        waitingForNeutral,
      }));
    }

    function stopGamepadMotion() {
      if (!isMoving) return;
      isMoving = false;
      callbacksRef.current.onStop();
    }

    function rising(controls, control) {
      return Boolean(controls[control] && !previousControls[control]);
    }

    function resetActionTracking(controls = {}) {
      previousControls = controls;
      avoidanceOffStartedAt = null;
      avoidanceOffSent = false;
      avoidanceOnStartedAt = null;
      avoidanceOnSent = false;
    }

    function readButtons(gamepad, now) {
      const layout = resolveGamepadLayout(gamepad);
      const controls = readGamepadControls(gamepad, layout);
      const l2 = controls.leftTrigger;
      const squareOrX = controls.faceLeft;
      let actionTriggered = false;

      function emitAction(action) {
        actionTriggered = true;
        callbacksRef.current.onAction(action);
      }

      // Os controles físicos são normalizados antes das ações. Assim, os
      // mesmos atalhos funcionam no layout padrão e no DirectInput genérico.
      if (isGamepadChordActivated(
        controls,
        previousControls,
        "leftTrigger",
        "faceRight",
      )) {
        emitAction("damping");
      } else if (isGamepadChordActivated(
        controls,
        previousControls,
        "leftTrigger",
        "faceLeft",
      )) {
        emitAction("recovery_stand");
      } else if (isGamepadChordActivated(
        controls,
        previousControls,
        "leftTrigger",
        "faceBottom",
      )) {
        emitAction("toggle_posture");
      } else if (rising(controls, "start") && !l2) {
        emitAction("arm");
      }

      if (!squareOrX || l2) {
        avoidanceOnStartedAt = null;
        avoidanceOnSent = false;
      } else if (!previousControls.faceLeft) {
        avoidanceOnStartedAt = now;
        avoidanceOnSent = false;
      } else if (
        !avoidanceOnSent &&
        avoidanceOnStartedAt !== null &&
        now - avoidanceOnStartedAt >= STANDALONE_BUTTON_GRACE_MS
      ) {
        avoidanceOnSent = true;
        emitAction("avoidance_on");
      }

      const avoidanceOffPressed = controls.faceTop && !l2;
      if (avoidanceOffPressed && !previousControls.faceTop) {
        avoidanceOffStartedAt = now;
        avoidanceOffSent = false;
      } else if (
        avoidanceOffPressed &&
        !avoidanceOffSent &&
        avoidanceOffStartedAt !== null &&
        now - avoidanceOffStartedAt >= 3_000
      ) {
        avoidanceOffSent = true;
        emitAction("avoidance_off");
      } else if (!avoidanceOffPressed) {
        avoidanceOffStartedAt = null;
        avoidanceOffSent = false;
      }

      previousControls = controls;
      return { actionTriggered, controls, layout };
    }

    function gamepadAt(index) {
      try {
        return navigator.getGamepads()[index] || null;
      } catch {
        return null;
      }
    }

    function firstGamepad() {
      try {
        // Chromium/Firefox podem manter temporariamente o objeto do controle
        // no array mesmo depois de retirar o cabo. Nunca trate esse objeto
        // residual como uma conexão ativa.
        return firstConnectedGamepad(navigator.getGamepads());
      } catch {
        return null;
      }
    }

    function tick(now) {
      let gamepad = activeIndex === null ? null : gamepadAt(activeIndex);
      if (!gamepad?.connected) gamepad = firstGamepad();

      if (!gamepad) {
        if (activeIndex !== null) {
          activeIndex = null;
          inputEnabled = false;
          resetActionTracking();
          axisBaselines = [];
          publishInputState(false, false);
          publishState(null);
          stopGamepadMotion();
        }
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      if (gamepad.index !== activeIndex) {
        activeIndex = gamepad.index;
        resetActionTracking();
        axisBaselines = gamepadAxisBaselines(gamepad);
        publishState(gamepad);
      }

      const layout = resolveGamepadLayout(gamepad);
      const controls = readGamepadControls(gamepad, layout);
      const vector = readGamepadMotion(
        gamepad,
        layout,
        controls,
        layout.kind === "generic" ? axisBaselines : null,
      );

      // A detecção do dispositivo continua ativa nos dois modos, mas nenhum
      // comando do gamepad pode escapar enquanto o operador escolheu botões.
      // Ao ativar ou retornar à aba, exigimos primeiro os manches em neutro.
      if (!callbacksRef.current.enabled || !pageActive) {
        inputEnabled = false;
        movementSuppressed = true;
        resetActionTracking(controls);
        publishInputState(false, false);
        stopGamepadMotion();
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }
      if (!inputEnabled) {
        inputEnabled = true;
        movementSuppressed = hasGamepadMotion(vector);
        resetActionTracking(controls);
        publishInputState(movementSuppressed, movementSuppressed);
        stopGamepadMotion();
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      const input = readButtons(gamepad, now);
      if (input.actionTriggered) {
        movementSuppressed = true;
        stopGamepadMotion();
      }
      const activeVector = readGamepadMotion(
        gamepad,
        input.layout,
        input.controls,
        input.layout.kind === "generic" ? axisBaselines : null,
      );
      const hasMotion = hasGamepadMotion(activeVector);
      if (!hasMotion) movementSuppressed = false;
      publishInputState(hasMotion, movementSuppressed && hasMotion);
      if (
        pageActive &&
        !movementSuppressed &&
        hasMotion &&
        callbacksRef.current.canMove
      ) {
        isMoving = true;
        callbacksRef.current.onMotion(activeVector);
      } else {
        stopGamepadMotion();
      }
      animationFrame = window.requestAnimationFrame(tick);
    }

    function handleConnected(event) {
      if (activeIndex === null) {
        activeIndex = event.gamepad.index;
        resetActionTracking();
        axisBaselines = gamepadAxisBaselines(event.gamepad);
      }
      if (event.gamepad.index === activeIndex) publishState(event.gamepad);
    }

    function handleDisconnected(event) {
      if (event.gamepad.index !== activeIndex) return;
      activeIndex = null;
      inputEnabled = false;
      resetActionTracking();
      axisBaselines = [];
      publishInputState(false, false);
      publishState(null);
      stopGamepadMotion();
    }

    function handleBlur() {
      pageActive = false;
      inputEnabled = false;
      publishInputState(false, false);
      stopGamepadMotion();
    }

    function handleFocus() {
      pageActive = !document.hidden;
    }

    function handleVisibility() {
      pageActive = !document.hidden && document.hasFocus();
      if (!pageActive) {
        inputEnabled = false;
        publishInputState(false, false);
        stopGamepadMotion();
      }
    }

    window.addEventListener("gamepadconnected", handleConnected);
    window.addEventListener("gamepaddisconnected", handleDisconnected);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("gamepadconnected", handleConnected);
      window.removeEventListener("gamepaddisconnected", handleDisconnected);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.cancelAnimationFrame(animationFrame);
      stopGamepadMotion();
    };
  }, []);

  return state;
}

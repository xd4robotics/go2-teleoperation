import { useCallback, useEffect, useRef, useState } from "react";

const MAX_TRAVEL = 42;
const DEAD_ZONE = 14;

function commandForOffset(x, y) {
  if (Math.hypot(x, y) < DEAD_ZONE) return null;
  if (Math.abs(x) > Math.abs(y)) return x < 0 ? "rotate_left" : "rotate_right";
  return y < 0 ? "forward" : "backward";
}

function MobileJoystick({
  disabled,
  disabledLabel = "BLOQUEADO",
  activeCommand,
  onCommandStart,
  onCommandStop,
}) {
  const surfaceRef = useRef(null);
  const pointerIdRef = useRef(null);
  const commandRef = useRef(null);
  const frameRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const reset = useCallback(() => {
    if (pointerIdRef.current === null && !commandRef.current) return;
    pointerIdRef.current = null;
    commandRef.current = null;
    window.cancelAnimationFrame(frameRef.current);
    setOffset({ x: 0, y: 0 });
    onCommandStop();
  }, [onCommandStop]);

  const updateFromPointer = useCallback((event) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const rawX = event.clientX - (bounds.left + bounds.width / 2);
    const rawY = event.clientY - (bounds.top + bounds.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const ratio = distance > MAX_TRAVEL ? MAX_TRAVEL / distance : 1;
    const nextOffset = { x: rawX * ratio, y: rawY * ratio };
    const nextCommand = commandForOffset(nextOffset.x, nextOffset.y);

    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => setOffset(nextOffset));

    if (nextCommand === commandRef.current) return;
    commandRef.current = nextCommand;
    if (nextCommand) onCommandStart(nextCommand);
    else onCommandStop();
  }, [onCommandStart, onCommandStop]);

  function handlePointerDown(event) {
    if (disabled || pointerIdRef.current !== null) return;
    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateFromPointer(event);
  }

  function handlePointerMove(event) {
    if (event.pointerId !== pointerIdRef.current) return;
    event.preventDefault();
    updateFromPointer(event);
  }

  function handlePointerEnd(event) {
    if (event.pointerId !== pointerIdRef.current) return;
    event.preventDefault();
    reset();
  }

  useEffect(() => {
    function cancelInteraction() {
      reset();
    }
    function cancelWhenHidden() {
      if (document.hidden) reset();
    }
    window.addEventListener("blur", cancelInteraction);
    window.addEventListener("pointerup", cancelInteraction);
    window.addEventListener("pointercancel", cancelInteraction);
    document.addEventListener("visibilitychange", cancelWhenHidden);
    return () => {
      window.removeEventListener("blur", cancelInteraction);
      window.removeEventListener("pointerup", cancelInteraction);
      window.removeEventListener("pointercancel", cancelInteraction);
      document.removeEventListener("visibilitychange", cancelWhenHidden);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [reset]);

  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  return (
    <div className={`mobile-joystick ${disabled ? "is-disabled" : ""}`}>
      <div
        ref={surfaceRef}
        className="mobile-joystick__surface"
        role="application"
        aria-label="Joystick de movimentação. Arraste para mover o robô."
        aria-disabled={disabled}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
      >
        <span className="mobile-joystick__axis mobile-joystick__axis--vertical" aria-hidden="true" />
        <span className="mobile-joystick__axis mobile-joystick__axis--horizontal" aria-hidden="true" />
        <span className="mobile-joystick__label mobile-joystick__label--up" aria-hidden="true">W <b>↑</b></span>
        <span className="mobile-joystick__label mobile-joystick__label--left" aria-hidden="true">A <b>↶</b></span>
        <span className="mobile-joystick__label mobile-joystick__label--down" aria-hidden="true">S <b>↓</b></span>
        <span className="mobile-joystick__label mobile-joystick__label--right" aria-hidden="true">D <b>↷</b></span>
        <span
          className="mobile-joystick__knob"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
          aria-hidden="true"
        />
      </div>
      <small>{activeCommand ? "MOVENDO" : disabled ? disabledLabel : "ARRASTE PARA MOVER"}</small>
    </div>
  );
}

export default MobileJoystick;

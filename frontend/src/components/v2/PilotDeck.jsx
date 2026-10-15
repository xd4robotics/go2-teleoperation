import { useEffect, useRef, useState } from "react";

import { useGamepadControl } from "../../services/useGamepadControl";
import { motionSendDelay, shapeYawInput } from "../../services/joystickMotion";
import styles from "./PilotDeck.module.css";

export function Joystick({ label, axisLabel, disabled, onVector, side, compact = false }) {
  const baseRef = useRef(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  function update(event) {
    if (disabled) return;
    const rect = baseRef.current.getBoundingClientRect();
    const radius = rect.width / 2 - 18;
    let x = event.clientX - (rect.left + rect.width / 2);
    let y = event.clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(x, y);
    if (length > radius) { x = x / length * radius; y = y / length * radius; }
    setPosition({ x, y });
    onVector({ x: Number((x / radius).toFixed(2)), y: Number((-y / radius).toFixed(2)) });
  }

  function start(event) {
    if (disabled) return;
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event);
  }

  function stop(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPosition({ x: 0, y: 0 });
    setActive(false);
    onVector({ x: 0, y: 0 });
  }

  return (
    <div className={`${styles.joystickUnit} ${side === "left" ? styles.leftJoystick : styles.rightJoystick} ${compact ? styles.compactJoystick : ""} ${disabled ? styles.disabled : ""}`}>
      <div className={styles.joystickCopy}><strong>{label}</strong><small>{axisLabel}</small></div>
      <div ref={baseRef} className={`${styles.joystick} ${active ? styles.joystickActive : ""}`} role="application" aria-label={`Joystick ${label}`} onPointerDown={start} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && update(event)} onPointerUp={stop} onPointerCancel={stop}>
        <i /><i /><b style={{ transform: `translate(${position.x}px, ${position.y}px)` }} />
      </div>
    </div>
  );
}

export default function PilotDeck({ status, onCommand, controlDevice, missionStartedAt }) {
  const motionTimerRef = useRef(null);
  const lastMotionSentAtRef = useRef(0);
  const gamepadSentAtRef = useRef(0);
  const speed = Number(status.speed_limit_percent) || 50;
  const [captureState, setCaptureState] = useState("");
  const [missionNow, setMissionNow] = useState(missionStartedAt || 0);
  const canMove = Boolean(status.control_armed && status.robot_online);

  useEffect(() => {
    return () => window.clearTimeout(motionTimerRef.current);
  }, []);

  useEffect(() => {
    if (!missionStartedAt) return undefined;
    const timer = window.setInterval(() => setMissionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [missionStartedAt]);

  const gamepad = useGamepadControl({
    enabled: controlDevice === "usb",
    canMove,
    onMotion: (vector) => {
      const now = performance.now();
      if (now - gamepadSentAtRef.current < 100) return;
      gamepadSentAtRef.current = now;
      onCommand("move_analog", vector);
    },
    onStop: () => onCommand("stop"),
    onAction: (action) => {
      const commands = { arm: "arm", damping: "damping", recovery_stand: "recovery_stand", avoidance_on: "set_obstacle_avoidance", avoidance_off: "set_obstacle_avoidance" };
      const command = commands[action];
      if (command) onCommand(command, command === "set_obstacle_avoidance" ? { enabled: action === "avoidance_on" } : {});
    },
  });

  function sendMotion(vector, rotationOnly = false) {
    window.clearTimeout(motionTimerRef.current);
    if (vector.x === 0 && vector.y === 0) {
      lastMotionSentAtRef.current = 0;
      onCommand("stop");
      return;
    }
    const payload = rotationOnly ? { forward: 0, lateral: 0, yaw: shapeYawInput(vector.x) } : { forward: vector.y, lateral: vector.x, yaw: 0 };
    const transmit = () => {
      lastMotionSentAtRef.current = performance.now();
      onCommand("move_analog", payload);
    };
    const delay = motionSendDelay(performance.now(), lastMotionSentAtRef.current);
    if (delay === 0) transmit();
    else motionTimerRef.current = window.setTimeout(transmit, delay);
  }

  function changeSpeed(delta) {
    if (!canMove) return;
    const next = Math.max(10, Math.min(100, speed + delta));
    onCommand("set_speed", { percent: next }, { speed_limit_percent: next });
  }

  async function fullscreen() {
    const view = document.getElementById("go2-teleoperation-view");
    if (!document.fullscreenElement) await view?.requestFullscreen?.();
    else await document.exitFullscreen?.();
  }

  function captureImage() {
    const media = document.getElementById("go2-camera-stage")?.querySelector("video, img.robot-camera-frame");
    const width = media?.tagName === "VIDEO" ? media.videoWidth : media?.naturalWidth;
    const height = media?.tagName === "VIDEO" ? media.videoHeight : media?.naturalHeight;
    if (!width || !height) {
      setCaptureState("FEED INDISPONÍVEL");
      window.setTimeout(() => setCaptureState(""), 1800);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(media, 0, 0);
    const link = document.createElement("a");
    link.download = `go2-capture-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png"); link.click();
    setCaptureState("IMAGEM CAPTURADA");
  }

  const virtualDisabled = !canMove || controlDevice !== "virtual";
  const missionSeconds = missionStartedAt ? Math.max(0, Math.floor((missionNow - missionStartedAt) / 1000)) : 0;
  const missionTime = new Date(missionSeconds * 1000).toISOString().slice(11, 19);

  return (
    <section className={styles.deck} aria-label="Central de pilotagem">
      <div className={styles.portraitMessage}><i>↻</i><strong>GIRE O DISPOSITIVO</strong><span>Modo horizontal necessário para habilitar a teleoperação por toque</span></div>
      <Joystick side="left" label="TRANSLATION" axisLabel="FRENTE · TRÁS · LATERAL" disabled={virtualDisabled} onVector={(vector) => sendMotion(vector)} />

      <div className={styles.centerConsole}>
        <div className={styles.mediaRail}>
          <span className={missionStartedAt ? styles.missionLive : ""}><small>MISSION TIME</small><b>{missionStartedAt ? missionTime : "STANDBY"}</b></span>
          <button type="button" onClick={fullscreen}><i>⛶</i><strong>TELA CHEIA</strong></button>
          <button type="button" onClick={captureImage}><i>▣</i><strong>CAPTURAR IMAGEM</strong></button>
        </div>
        <div className={styles.speedBlock}>
          <span>VELOCIDADE NOMINAL</span>
          <div><button type="button" disabled={!canMove} onClick={() => changeSpeed(-10)} aria-label="Reduzir velocidade">−</button><strong>{speed}%</strong><button type="button" disabled={!canMove} onClick={() => changeSpeed(10)} aria-label="Aumentar velocidade">+</button></div>
          <i><b style={{ width: `${speed}%` }} /></i>
          <small>{canMove ? `${controlDevice === "usb" ? gamepad.name || "USB" : "VIRTUAL"} · CONTROLE LIBERADO` : "CONTROLE BLOQUEADO"}</small>
        </div>
        {captureState && <div className={styles.captureFeedback}>{captureState}</div>}
      </div>

      <Joystick side="right" label="YAW / GIRO" axisLabel="ROTAÇÃO NO PRÓPRIO EIXO" disabled={virtualDisabled} onVector={(vector) => sendMotion(vector, true)} />
    </section>
  );
}

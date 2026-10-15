import { useEffect, useRef, useState } from "react";
import { RoomEvent, Track } from "livekit-client";

import { formatAutonomy, formatBatteryPercent, readRobotTemperature } from "../../services/robotTelemetry";
import { startLocalRobotAudio } from "../../services/localRobotAudio";
import { motionSendDelay, shapeYawInput } from "../../services/joystickMotion";
import { Joystick } from "./PilotDeck";
import styles from "./MobileOperations.module.css";

function Metric({ label, value, tone = "" }) {
  return <span className={tone ? styles[tone] : ""}><small>{label}</small><strong>{value}</strong></span>;
}

function Action({ children, active = false, danger = false, onClick, disabled = false }) {
  return <button className={`${styles.action} ${active ? styles.active : ""} ${danger ? styles.danger : ""}`} type="button" onClick={onClick} disabled={disabled}>{children}</button>;
}

function MobileToggle({ title, detail, active, onClick, disabled = false }) {
  return (
    <button className={`${styles.toggleCard} ${active ? styles.toggleCardOn : ""}`} type="button" onClick={onClick} disabled={disabled} aria-pressed={active}>
      <span><strong>{title}</strong><small>{detail}</small></span>
      <span className={styles.toggleState}><b>{active ? "ON" : "OFF"}</b><i><em /></i></span>
    </button>
  );
}

export default function MobileOperations({
  status,
  accessToken,
  liveKitRoom,
  userId,
  onCommand,
  commandState,
  controlDevice,
  onControlDeviceChange,
  menuOpen,
  onMenuClose,
  missionStartedAt,
}) {
  const speed = Number(status.speed_limit_percent) || 50;
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [captureState, setCaptureState] = useState("");
  const [missionNow, setMissionNow] = useState(missionStartedAt || 0);
  const motionTimerRef = useRef(null);
  const lastMotionSentAtRef = useRef(0);
  const stopVoiceRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const armed = Boolean(status.control_armed);
  const avoidance = typeof status.obstacle_avoidance_requested === "boolean"
    ? status.obstacle_avoidance_requested
    : Boolean(status.obstacle_avoidance_enabled);
  const temperature = readRobotTemperature(status);

  useEffect(() => {
    if (!missionStartedAt) return undefined;
    const timer = window.setInterval(() => setMissionNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [missionStartedAt]);

  useEffect(() => () => window.clearTimeout(motionTimerRef.current), []);

  useEffect(() => {
    if (!voiceOn || !liveKitRoom) return undefined;
    const attached = new Map();

    function attachAudio(track) {
      if (track.kind !== Track.Kind.Audio || attached.has(track.sid)) return;
      const element = track.attach();
      element.autoplay = true;
      element.hidden = true;
      document.body.appendChild(element);
      void element.play().catch(() => setVoiceError("Toque novamente para liberar o áudio."));
      attached.set(track.sid, { track, element });
    }

    for (const participant of liveKitRoom.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.kind !== Track.Kind.Audio) continue;
        publication.setSubscribed?.(true);
        if (publication.track) attachAudio(publication.track);
      }
    }
    liveKitRoom.on(RoomEvent.TrackSubscribed, attachAudio);
    return () => {
      liveKitRoom.off(RoomEvent.TrackSubscribed, attachAudio);
      for (const { track, element } of attached.values()) {
        track.detach(element);
        element.remove();
      }
    };
  }, [liveKitRoom, voiceOn]);

  useEffect(() => () => {
    void stopVoiceRef.current?.();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function closeOnEscape(event) { if (event.key === "Escape") onMenuClose(); }
    document.addEventListener("keydown", closeOnEscape);
    document.body.classList.add("mobile-drawer-open");
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.classList.remove("mobile-drawer-open");
    };
  }, [menuOpen, onMenuClose]);

  function changeSpeed(delta) {
    if (!armed) return;
    const next = Math.max(10, Math.min(100, speed + delta));
    onCommand("set_speed", { percent: next }, { speed_limit_percent: next });
  }

  function setPosture(next) {
    if (!armed) return;
    onCommand(next === "standing" ? "stand_up" : "stand_down", {}, { posture: next });
  }

  function setManualControl(next) {
    onCommand(next ? "arm" : "disarm", {}, { control_armed: next });
  }

  function toggleAvoidance() {
    const enabled = !avoidance;
    onCommand(
      "set_obstacle_avoidance",
      { enabled },
      {
        obstacle_avoidance_enabled: enabled,
        obstacle_avoidance_requested: enabled,
      },
    );
  }

  async function toggleVoice() {
    setVoiceError("");
    if (voiceOn) {
      await stopVoiceRef.current?.();
      stopVoiceRef.current = null;
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      setVoiceOn(false);
      return;
    }
    try {
      if (!liveKitRoom) throw new Error("LiveKit ainda não conectado.");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneStreamRef.current = stream;
      stopVoiceRef.current = await startLocalRobotAudio(accessToken, stream.getAudioTracks()[0], {
        room: liveKitRoom,
        userId,
        voiceActivated: true,
      });
      setVoiceOn(true);
    } catch (error) {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      setVoiceError(error.message || "Não foi possível conectar o áudio.");
      setVoiceOn(false);
    }
  }

  function sendMotion(vector, rotationOnly = false) {
    window.clearTimeout(motionTimerRef.current);
    if (vector.x === 0 && vector.y === 0) {
      lastMotionSentAtRef.current = 0;
      onCommand("stop");
      return;
    }
    if (!armed) return;
    const payload = rotationOnly ? { forward: 0, lateral: 0, yaw: shapeYawInput(vector.x) } : { forward: vector.y, lateral: vector.x, yaw: 0 };
    const transmit = () => {
      lastMotionSentAtRef.current = performance.now();
      onCommand("move_analog", payload);
    };
    const delay = motionSendDelay(performance.now(), lastMotionSentAtRef.current);
    if (delay === 0) transmit();
    else motionTimerRef.current = window.setTimeout(transmit, delay);
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
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(media, 0, 0);
    const link = document.createElement("a");
    link.download = `go2-capture-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setCaptureState("IMAGEM CAPTURADA");
    window.setTimeout(() => setCaptureState(""), 1800);
  }

  const missionSeconds = missionStartedAt ? Math.max(0, Math.floor((missionNow - missionStartedAt) / 1000)) : 0;
  const missionTime = missionStartedAt ? new Date(missionSeconds * 1000).toISOString().slice(11, 19) : "STANDBY";
  const latency = Number.isFinite(Number(status.command_latency_ms)) ? `${Math.round(Number(status.command_latency_ms))} ms` : "-- ms";
  const virtualDisabled = !status.control_armed || !status.robot_online || controlDevice !== "virtual";

  return (
    <section className={styles.mobile} aria-label="Controles móveis de teleoperação">
      <div className={styles.portraitControls}>
        <div className={styles.controlToggles}>
          <MobileToggle title="OBSTACLE AVOIDANCE" detail="Proteção de perímetro" active={avoidance} onClick={toggleAvoidance} disabled={commandState.busy === "set_obstacle_avoidance" || status.obstacle_avoidance_transitioning} />
          <MobileToggle title="CONTROLE" detail="Central de comandos" active={armed} onClick={() => setManualControl(!armed)} />
        </div>
        <div className={styles.posture}>
          <Action active={status.posture === "standing"} disabled={!armed} onClick={() => setPosture("standing")}>↑ LEVANTAR</Action>
          <Action active={status.posture === "lying" || status.posture === "sitting"} disabled={!armed} onClick={() => setPosture("lying")}>↓ DEITAR</Action>
        </div>
        <div className={styles.portraitJoysticks} aria-label="Controles de movimento por toque">
          <Joystick compact side="left" label="MOVIMENTO" axisLabel="FRENTE · TRÁS · LATERAL" disabled={virtualDisabled} onVector={(vector) => sendMotion(vector)} />
          <Joystick compact side="right" label="GIRO" axisLabel="YAW" disabled={virtualDisabled} onVector={(vector) => sendMotion(vector, true)} />
        </div>
        <div className={styles.utilityControls}>
          <div className={`${styles.speed} ${!armed ? styles.speedDisabled : ""}`}>
            <span><small>VELOCIDADE</small><b>{speed}%</b></span>
            <button type="button" disabled={!armed} onClick={() => changeSpeed(-10)} aria-label="Reduzir velocidade">−</button>
            <button type="button" disabled={!armed} onClick={() => changeSpeed(10)} aria-label="Aumentar velocidade">+</button>
          </div>
          <button className={`${styles.robotAudio} ${voiceOn ? styles.voiceActive : ""}`} type="button" onClick={toggleVoice}><span aria-hidden="true">◖))</span><small>ÁUDIO DO ROBÔ</small><strong>{voiceOn ? "ATIVO" : "CONECTAR"}</strong></button>
        </div>
        <p className={styles.feedback}>{voiceError || captureState || commandState.message || "PRONTO PARA OPERAÇÃO"}</p>
        <button className={`${styles.emergency} ${styles.portraitEmergency}`} type="button" onClick={() => onCommand("emergency_stop", {}, { control_armed: false, current_speed_mps: 0, posture: "transitioning_down" })}>
          <i>■</i><span>PARADA DE EMERGÊNCIA</span>
        </button>
      </div>

      <div className={styles.landscapeRail}>
        <div>
          <Action active={avoidance} onClick={toggleAvoidance}>OBSTACLE {avoidance ? "ON" : "OFF"}</Action>
          <Action active={voiceOn} onClick={toggleVoice}>ÁUDIO {voiceOn ? "●" : "○"}</Action>
          <Action disabled={!armed} onClick={() => setPosture("standing")}>↑ LEVANTAR</Action>
          <Action disabled={!armed} onClick={() => setPosture("lying")}>↓ DEITAR</Action>
        </div>
      </div>

      <button className={`${styles.emergency} ${styles.landscapeEmergency}`} type="button" onClick={() => onCommand("emergency_stop", {}, { control_armed: false, current_speed_mps: 0, posture: "transitioning_down" })}>
        <i>■</i><span>PARADA DE EMERGÊNCIA</span>
      </button>

      {menuOpen && <button className={styles.backdrop} type="button" aria-label="Fechar menu" onClick={onMenuClose} />}
      <aside className={`${styles.drawer} ${menuOpen ? styles.drawerOpen : ""}`} aria-hidden={!menuOpen} aria-label="Menu operacional">
        <header><div><small>XD4 // TELEOPERAÇÃO</small><strong>PAINEL OPERACIONAL</strong></div><button type="button" onClick={onMenuClose} aria-label="Fechar menu">×</button></header>
        <div className={styles.drawerContent}>
          <details className={styles.robotGroup} open>
            <summary>ROBÔ E CONTROLE <span>{status.robot_online ? "ONLINE" : "OFFLINE"}</span></summary>
            <div className={styles.metrics}>
              <Metric label="CONEXÃO" value={status.robot_online ? "ONLINE" : "OFFLINE"} tone={status.robot_online ? "good" : "bad"} />
              <Metric label="SDK" value={status.sdk_connected ? "CONECTADO" : "SEM LINK"} tone={status.sdk_connected ? "good" : "bad"} />
              <Metric label="IDENTIFICAÇÃO" value="GO2-EDU" />
              <Metric label="UNIDADE" value="UNIT-07" />
            </div>
            <div className={styles.segmented}><button className={controlDevice === "virtual" ? styles.selected : ""} type="button" onClick={() => onControlDeviceChange("virtual")}>VIRTUAL</button><button className={controlDevice === "usb" ? styles.selected : ""} type="button" onClick={() => onControlDeviceChange("usb")}>USB</button></div>
            <div className={styles.drawerActions}>
              <Action active={armed} danger={!armed} onClick={() => onCommand(armed ? "disarm" : "arm", {}, { control_armed: !armed })}>{armed ? "CONTROLE HABILITADO" : "CONTROLE BLOQUEADO"}</Action>
              <Action active={avoidance} onClick={toggleAvoidance}>PERÍMETRO {avoidance ? "ATIVO" : "DESATIVADO"}</Action>
            </div>
          </details>

          <details className={styles.telemetryGroup}>
            <summary>ESTADO DO ROBÔ <span>TELEMETRIA</span></summary>
            <div className={styles.metrics}>
              <Metric label="BATERIA" value={formatBatteryPercent(status.battery_percent)} />
              <Metric label="AUTONOMIA" value={formatAutonomy(status.autonomy_minutes, status.charging)} />
              <Metric label="TEMPERATURA" value={temperature.label} tone={temperature.tone === "is-temperature-high" ? "bad" : "good"} />
              <Metric label="LATÊNCIA" value={latency} />
            </div>
          </details>

          <details className={styles.cameraGroup}>
            <summary>VÍDEO E CAPTURA <span>{status.camera_connected ? "LIVE" : "SEM SINAL"}</span></summary>
            <div className={styles.metrics}><Metric label="FEED" value={status.camera_connected ? "STREAM ATIVO" : "OFFLINE"} tone={status.camera_connected ? "good" : "bad"} /><Metric label="CÂMERA ATUAL" value="CAM 01 · FRONTAL" /></div>
            <div className={styles.drawerActions}><Action onClick={captureImage}>▣ CAPTURAR IMAGEM</Action></div>
          </details>

          <details className={styles.systemsGroup}>
            <summary>ÁUDIO DO ROBÔ <span>{voiceOn ? "CANAL ATIVO" : "DESCONECTADO"}</span></summary>
            <div className={styles.drawerActions}>
              <Action active={voiceOn} onClick={toggleVoice}>{voiceOn ? "ENCERRAR CANAL DE VOZ" : "INICIAR CANAL DE VOZ"}</Action>
            </div>
            {voiceError && <p className={styles.feedback}>{voiceError}</p>}
          </details>

          <details className={styles.missionGroup}>
            <summary>MISSÃO <span>{missionTime}</span></summary>
            <div className={styles.metrics}><Metric label="MISSION TIME" value={missionTime} /><Metric label="CÂMERA" value={status.camera_connected ? "STREAM ATIVO" : "SEM SINAL"} tone={status.camera_connected ? "good" : "bad"} /></div>
          </details>
        </div>
      </aside>
    </section>
  );
}

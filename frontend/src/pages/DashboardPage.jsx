import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import OnlineUsersPresence from "../components/OnlineUsersPresence";
import BrandHeader from "../components/v2/BrandHeader";
import CameraStage from "../components/v2/CameraStage";
import CommandPanel from "../components/v2/CommandPanel";
import MobileOperations from "../components/v2/MobileOperations";
import PilotDeck from "../components/v2/PilotDeck";
import TelemetryPanel from "../components/v2/TelemetryPanel";
import { useAuth } from "../context/useAuth";
import { getRobotStatus, sendRobotCommand } from "../services/api";
import { isLiveKitEnabled } from "../services/livekit";
import { publishLiveKitCommand } from "../services/livekitCommands";
import { formatAutonomy, readRobotTemperature } from "../services/robotTelemetry";
import { useLiveKitRobot } from "../services/useLiveKitRobot";
import styles from "./DashboardPage.module.css";

const OFFLINE_STATUS = {
  robot_online: false,
  sdk_connected: false,
  camera_connected: false,
  battery_percent: null,
  autonomy_minutes: null,
  robot_temperature_c: null,
  current_speed_mps: 0,
  speed_limit_percent: 50,
  control_armed: false,
  obstacle_avoidance_enabled: false,
  docking_station_calibrated: false,
  posture: "unknown",
  point_count: 0,
};

export default function DashboardPage({ isDarkMode, onToggleTheme }) {
  const navigate = useNavigate();
  const { session, signOut } = useAuth();
  const [robotStatus, setRobotStatus] = useState(OFFLINE_STATUS);
  const [commandState, setCommandState] = useState({ busy: "", message: "" });
  const [avoidanceOverride, setAvoidanceOverride] = useState(null);
  const avoidanceOverrideTimerRef = useRef(null);
  const [speedOverride, setSpeedOverride] = useState(null);
  const speedOverrideTimerRef = useRef(null);
  const [controlDevice, setControlDevice] = useState("virtual");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [missionStartedAt, setMissionStartedAt] = useState(() => {
    const saved = Number(sessionStorage.getItem("xd4-mission-started-at"));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const accessToken = session?.access_token;
  const liveKit = useLiveKitRobot(accessToken);
  const userId = session?.user?.id;
  const nativeBridgeOnline = Boolean(
    liveKit.commandGatewayConnected && liveKit.audioBridgeConnected,
  );
  const resolvedStatus = isLiveKitEnabled
    ? {
        ...robotStatus,
        ...(liveKit.telemetry || {}),
        robot_online: Boolean(
          liveKit.telemetry?.robot_online
          || robotStatus.robot_online
          || nativeBridgeOnline,
        ),
        sdk_connected: Boolean(
          liveKit.telemetry?.sdk_connected
          || robotStatus.sdk_connected
          || nativeBridgeOnline,
        ),
        gateway_connected: Boolean(
          liveKit.telemetry?.gateway_connected
          || robotStatus.gateway_connected
          || liveKit.commandGatewayConnected,
        ),
      }
    : robotStatus;
  const avoidanceStatus = avoidanceOverride === null
    ? resolvedStatus
    : {
        ...resolvedStatus,
        obstacle_avoidance_enabled: avoidanceOverride,
        obstacle_avoidance_requested: avoidanceOverride,
        obstacle_avoidance_transitioning: true,
      };
  const displayedStatus = speedOverride === null
    ? avoidanceStatus
    : { ...avoidanceStatus, speed_limit_percent: speedOverride };
  const temperature = readRobotTemperature(displayedStatus);
  const yawRateRad = Number(displayedStatus.sport_state?.yaw_speed);
  const yawRateDps = Number.isFinite(Number(displayedStatus.yaw_rate_dps))
    ? Number(displayedStatus.yaw_rate_dps)
    : Number.isFinite(yawRateRad) ? yawRateRad * 180 / Math.PI : null;

  useEffect(() => {
    if (!accessToken) return undefined;
    let active = true;

    async function refreshStatus() {
      try {
        const status = await getRobotStatus(accessToken);
        if (active) setRobotStatus((current) => ({ ...current, ...status, status_poll_stale: false }));
      } catch {
        // Uma falha momentanea da Function (rede movel, cold start ou troca de
        // rota) nao significa que o robo ficou offline. A presenca real e
        // atualizada pelo LiveKit e a proxima consulta bem-sucedida reconcilia
        // o estado sem derrubar visualmente um gateway que continua ativo.
        if (active) setRobotStatus((current) => ({ ...current, status_poll_stale: true }));
      }
    }

    refreshStatus();
    const timer = window.setInterval(refreshStatus, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accessToken]);

  useEffect(() => () => {
    window.clearTimeout(avoidanceOverrideTimerRef.current);
    window.clearTimeout(speedOverrideTimerRef.current);
  }, []);

  const runCommand = useCallback(async (command, payload = {}, optimistic = {}) => {
    const isMotionCommand = command === "move_analog" || command === "stop";
    if (command === "set_obstacle_avoidance") {
      const requested = Boolean(payload.enabled);
      window.clearTimeout(avoidanceOverrideTimerRef.current);
      setAvoidanceOverride(requested);
      avoidanceOverrideTimerRef.current = window.setTimeout(
        () => setAvoidanceOverride(null),
        4_000,
      );
    }
    if (command === "arm" && !missionStartedAt) {
      const startedAt = Date.now();
      setMissionStartedAt(startedAt);
      sessionStorage.setItem("xd4-mission-started-at", String(startedAt));
    }
    if (command === "set_speed") {
      const requestedSpeed = Number(payload.percent);
      if (Number.isFinite(requestedSpeed)) {
        window.clearTimeout(speedOverrideTimerRef.current);
        setSpeedOverride(requestedSpeed);
        speedOverrideTimerRef.current = window.setTimeout(() => setSpeedOverride(null), 4_000);
      }
    }
    setRobotStatus((current) => ({ ...current, ...optimistic }));
    if (!isMotionCommand) setCommandState({ busy: command, message: "" });
    if (!accessToken) {
      if (!isMotionCommand) setCommandState({ busy: "", message: "MODO LOCAL · SDK DESCONECTADO" });
      return;
    }
    try {
      const commandStartedAt = performance.now();
      if (isMotionCommand && liveKit.room?.state === "connected") {
        await publishLiveKitCommand(liveKit.room, userId, command, payload);
      } else if (command === "move_analog") {
        // Nunca enfileira movimento na Function da Vercel: se o canal direto
        // caiu, é mais seguro descartar a amostra do que executá-la atrasada.
        throw new Error("Canal direto de controle indisponível.");
      } else {
        await sendRobotCommand(accessToken, command, payload);
      }
      if (!isMotionCommand) {
        setRobotStatus((current) => ({ ...current, command_latency_ms: Math.round(performance.now() - commandStartedAt) }));
        setCommandState({ busy: "", message: "" });
      }
    } catch (error) {
      if (command === "set_obstacle_avoidance") {
        window.clearTimeout(avoidanceOverrideTimerRef.current);
        setAvoidanceOverride(null);
      }
      if (command === "set_speed") {
        window.clearTimeout(speedOverrideTimerRef.current);
        setSpeedOverride(null);
      }
      setCommandState({ busy: "", message: error.message || "COMANDO RECUSADO" });
    }
  }, [accessToken, liveKit.room, missionStartedAt, userId]);

  async function leaveDashboard() {
    sessionStorage.removeItem("xd4-demo-mode");
    sessionStorage.removeItem("xd4-mission-started-at");
    if (session) {
      try { await signOut(); } catch { /* mantém o terminal local acessível */ }
    }
    navigate("/login", { replace: true });
  }

  return (
    <div className={styles.page}>
      <BrandHeader
        isDarkMode={isDarkMode}
        onToggleTheme={onToggleTheme}
        onExit={leaveDashboard}
        onMenuClick={() => setMobileMenuOpen(true)}
        mobileStatus={{
          online: displayedStatus.robot_online,
          battery: displayedStatus.battery_percent,
          latency: Number.isFinite(Number(displayedStatus.command_latency_ms)) ? Math.round(Number(displayedStatus.command_latency_ms)) : null,
        }}
      />

      <main className={styles.content}>
        <section className={styles.operationalStrip}>
          <div className={styles.operationId}>
            <span><i /> LIVE CONTROL</span>
            <strong>GO2-EDU / UNIT-07</strong>
          </div>
          <div className={styles.deviceSelector} aria-label="Dispositivo de comando">
            <span>COMANDO</span>
            <button className={controlDevice === "virtual" ? styles.deviceActive : ""} type="button" onClick={() => setControlDevice("virtual")}>VIRTUAL</button>
            <button className={controlDevice === "usb" ? styles.deviceActive : ""} type="button" onClick={() => setControlDevice("usb")}>USB</button>
          </div>
          <div className={styles.signalRail}>
            <span><em data-mobile="ROBÔ">ROBOT</em><b className={displayedStatus.robot_online ? styles.robotOnline : styles.robotOffline}><i />{displayedStatus.robot_online ? "ONLINE" : "OFFLINE"}</b></span>
            <span><em data-mobile="BAT">BATTERY</em><b>{displayedStatus.battery_percent ?? "--"}%</b></span>
            <span><em data-mobile="AUTON.">AUTONOMIA</em><b>{formatAutonomy(displayedStatus.autonomy_minutes, displayedStatus.charging)}</b></span>
            <span><em data-mobile="TEMP">TEMPERATURE</em><b>{temperature.label}</b></span>
            <span><em data-mobile="YAW">YAW / GIRO</em><b>{yawRateDps === null ? "--°/S" : `${yawRateDps.toFixed(1)}°/S`}</b></span>
          </div>
        </section>

        <div className={styles.operationalView} id="go2-teleoperation-view">
          <section className={styles.workspace}>
            <CommandPanel status={displayedStatus} onCommand={runCommand} commandState={commandState} />
            <CameraStage status={displayedStatus} accessToken={accessToken} liveKit={liveKit} />
            <TelemetryPanel status={displayedStatus} onCommand={runCommand} commandState={commandState} />
          </section>

          <PilotDeck status={displayedStatus} onCommand={runCommand} controlDevice={controlDevice} missionStartedAt={missionStartedAt} />
          <MobileOperations
            status={displayedStatus}
            accessToken={accessToken}
            liveKitRoom={liveKit.room}
            userId={userId}
            onCommand={runCommand}
            commandState={commandState}
            controlDevice={controlDevice}
            onControlDeviceChange={setControlDevice}
            menuOpen={mobileMenuOpen}
            onMenuClose={() => setMobileMenuOpen(false)}
            missionStartedAt={missionStartedAt}
          />
        </div>

        <footer className={styles.statusBar}>
          <span><i /> {displayedStatus.robot_online ? "CONTROL BUS NOMINAL" : "CONTROL BUS OFFLINE"}</span>
          <OnlineUsersPresence enabled />
          <span>{commandState.message || "AGUARDANDO COMANDO"}</span>
          <b>XD4 TELEOPERATION CORE // GO2 SDK</b>
        </footer>
      </main>
    </div>
  );
}

import { useState } from "react";

import { formatAutonomy, formatBatteryPercent, readRobotTemperature } from "../../services/robotTelemetry";
import styles from "./TelemetryPanel.module.css";

function Meter({ value = 0, tone = "blue" }) {
  return <div className={styles.meter}><i className={styles[tone]} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />{Array.from({ length: 10 }, (_, index) => <span key={index} />)}</div>;
}

function quaternionAngles(imu) {
  if (!imu || ![imu.qx, imu.qy, imu.qz, imu.qw].every(Number.isFinite)) return null;
  const roll = Math.atan2(2 * (imu.qw * imu.qx + imu.qy * imu.qz), 1 - 2 * (imu.qx ** 2 + imu.qy ** 2));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (imu.qw * imu.qy - imu.qz * imu.qx))));
  return { roll: roll * 180 / Math.PI, pitch: pitch * 180 / Math.PI };
}

function IMUWave({ imu }) {
  const angles = quaternionAngles(imu);

  function pathFor(axis) {
    if (!angles) return "M0 22.5 L180 22.5";
    const amplitude = Math.max(2.5, Math.min(17, Math.abs(angles[axis]) * 1.3));
    return Array.from({ length: 49 }, (_, index) => {
      const x = index * 180 / 48;
      const y = 22.5 + Math.sin(index * .62 + (axis === "pitch" ? 1.7 : 0)) * amplitude;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }

  return (
    <div className={styles.imuScope}>
      <header><span>IMU REAL-TIME WAVE</span><b>{angles ? "LIVE" : "NO DATA"}</b></header>
      <svg viewBox="0 0 180 45" preserveAspectRatio="none" aria-label="Osciloscópio de roll e pitch">
        <path className={styles.scopeGrid} d="M0 11.25H180 M0 22.5H180 M0 33.75H180 M45 0V45 M90 0V45 M135 0V45" />
        <path className={styles.rollWave} d={pathFor("roll")} />
        <path className={styles.pitchWave} d={pathFor("pitch")} />
      </svg>
      <footer><span><i /> ROLL <b>{angles ? angles.roll.toFixed(1) : "--"}°</b></span><span><i /> PITCH <b>{angles ? angles.pitch.toFixed(1) : "--"}°</b></span></footer>
    </div>
  );
}

function jointLoads(status) {
  const source = status.joint_load_percent || status.joint_torque_percent || status.telemetry?.joint_load_percent;
  const labels = ["LF", "RF", "LH", "RH"];
  if (Array.isArray(source)) return labels.map((label, index) => ({ label, value: Number(source[index]) || 0 }));
  if (source && typeof source === "object") return labels.map((label) => ({ label, value: Number(source[label] ?? source[label.toLowerCase()]) || 0 }));
  return labels.map((label) => ({ label, value: 0 }));
}

export default function TelemetryPanel({ status, onCommand, commandState }) {
  const [calling, setCalling] = useState(false);
  const battery = Number(status.battery_percent);
  const batteryValue = Number.isFinite(battery) ? battery : 0;
  const temperature = readRobotTemperature(status);
  const temperatureValue = Number(status.robot_temperature_c);
  const isHot = temperature.tone === "is-temperature-high" || (Number.isFinite(temperatureValue) && temperatureValue >= 55);
  const calibrated = Boolean(status.docking_station_calibrated);
  const loads = jointLoads(status);
  const hasJointData = loads.some((item) => item.value > 0);
  const imu = status.imu || status.telemetry?.imu;

  return (
    <aside className={styles.panel}>
      <div className={styles.heading}><span>TELEMETRY // GO2</span><b><i /> SDK BUS</b></div>

      <section className={styles.energy}>
        <header><span>PWR/BAT-01</span></header>
        <div className={styles.energyValues}><p><small>BATERIA</small><b>{formatBatteryPercent(status.battery_percent)}</b></p><p><small>AUTONOMIA ESTIMADA</small><b>{formatAutonomy(status.autonomy_minutes, status.charging)}</b></p></div>
        <Meter value={batteryValue} />
        <footer><span>{status.charging ? "CARREGANDO NA BASE" : status.battery_voltage_v ? `${status.battery_voltage_v}V` : "SEM LEITURA DE TENSÃO"}</span><b>{batteryValue <= 15 && batteryValue > 0 ? "NÍVEL CRÍTICO" : "BMS NOMINAL"}</b></footer>
      </section>

      <section className={`${styles.temperature} ${isHot ? styles.hot : styles.stable}`}>
        <div><span>THERM/CORE</span></div><b>{temperature.label}</b>
        <Meter value={Number.isFinite(temperatureValue) ? temperatureValue : 0} tone={isHot ? "red" : "green"} />
        <small>{isHot ? "ALERTA · LIMITE TÉRMICO EXCEDIDO" : "SISTEMA ESTÁVEL · LIMITE 55°C"}</small>
      </section>

      <button className={`${styles.audio} ${calling ? styles.calling : ""}`} type="button" onClick={() => setCalling((value) => !value)}>
        <span className={styles.audioCore} aria-hidden="true"><i /><i /><i /></span>
        <p><strong>{calling ? "CANAL DE VOZ ATIVO" : "INICIAR CANAL DE VOZ"}</strong><small>Áudio bidirecional do Go2</small></p>
        <b>{calling ? "ENCERRAR" : "CONECTAR"}</b>
      </button>

      {commandState.message && <div className={styles.telemetryFeedback}>{commandState.message}</div>}

      <section className={styles.jointMonitor}>
        <header><span>MOTOR/TORQUE</span><b>{hasJointData ? "SDK LIVE" : "NO DATA"}</b></header>
        <div>{loads.map((leg) => <p key={leg.label}><span>{leg.label}</span><i><b style={{ width: `${Math.max(0, Math.min(100, leg.value))}%` }} /></i><em>{hasJointData ? `${Math.round(leg.value)}%` : "--"}</em></p>)}</div>
      </section>

      <section className={styles.vector}>
        <header><span>POSE VECTOR</span><b>IMU // {status.robot_online ? "LOCK" : "NO DATA"}</b></header>
        <div className={styles.vectorGrid}><span>X <b>{status.pose?.x?.toFixed?.(3) ?? "--"}</b></span><span>Y <b>{status.pose?.y?.toFixed?.(3) ?? "--"}</b></span><span>Z <b>{status.pose?.z?.toFixed?.(3) ?? "--"}</b></span></div>
        <div className={styles.compass}>
          <i style={{ transform: `translate(-50%, -50%) rotate(${Number(status.yaw_degrees) || 0}deg)` }} />
          <b>{Number.isFinite(Number(status.yaw_degrees)) ? `${Number(status.yaw_degrees).toFixed(1)}°` : "--°"}</b>
          <span>N</span><span>E</span><span>S</span><span>W</span>
        </div>
        <IMUWave imu={imu} />
      </section>

      <section className={styles.docking}>
        <header><span>⌂</span><div><small>DOCKING STATION</small><strong>{calibrated ? "BASE CALIBRADA" : "BASE NÃO CALIBRADA"}</strong></div><i className={calibrated ? styles.dockReady : ""} /></header>
        <div><button type="button" onClick={() => onCommand("start_docking")}>↗ ENVIAR À BASE</button><button type="button" onClick={() => onCommand("calibrate_docking_station", {}, { docking_station_calibrated: true })}>⌖ CALIBRAR ESTAÇÃO</button></div>
        <small>{status.docking_active ? `ROTA ATIVA · ${status.docking_state || "APROXIMANDO"}` : "ESTAÇÃO EM ESPERA"}</small>
      </section>
    </aside>
  );
}

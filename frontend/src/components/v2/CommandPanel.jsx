import { useState } from "react";

import styles from "./CommandPanel.module.css";

function Toggle({ active, label, detail, onClick, danger = false }) {
  return (
    <button className={`${styles.toggleRow} ${active ? styles.toggleActive : ""} ${danger ? styles.toggleDanger : ""}`} type="button" onClick={onClick}>
      <span><strong>{label}</strong><small>{detail}</small></span>
      <i><b /></i>
    </button>
  );
}

export default function CommandPanel({ status, onCommand, commandState }) {
  const [gaitMode, setGaitMode] = useState("trot");
  const [lightsOn, setLightsOn] = useState(false);
  const [lightLevel, setLightLevel] = useState(50);

  const armed = Boolean(status.control_armed);
  const avoidance = typeof status.obstacle_avoidance_requested === "boolean"
    ? status.obstacle_avoidance_requested
    : Boolean(status.obstacle_avoidance_enabled);
  const posture = status.posture || "unknown";

  function setControl(next) {
    onCommand(next ? "arm" : "disarm", {}, { control_armed: next });
  }

  function setCollision(next) {
    onCommand("set_obstacle_avoidance", { enabled: next }, {
      obstacle_avoidance_enabled: next,
      obstacle_avoidance_requested: next,
    });
  }

  function setRobotPosture(next) {
    onCommand(next === "standing" ? "stand_up" : "stand_down", {}, { posture: next });
  }

  function emergencyStop() {
    onCommand("emergency_stop", {}, {
      control_armed: false,
      current_speed_mps: 0,
      posture: "transitioning_down",
    });
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.heading}><span>CONTROLE PRIMÁRIO</span><i>•••</i></div>

      <div className={styles.connection}>
        <span className={!status.robot_online ? styles.offline : ""}><i /> {status.robot_online ? "CONECTADO" : "OFFLINE"}</span>
        <small>UNITREE GO2 · SDK2</small>
        <b>{status.sdk_connected ? "SDK OK" : "NO LINK"}</b>
      </div>

      <section className={styles.safetyControls}>
        <label>CHAVES DE SEGURANÇA</label>
        <Toggle active={armed} danger={!armed} label={armed ? "CONTROLE HABILITADO" : "CONTROLE BLOQUEADO"} detail="Trava de software" onClick={() => setControl(!armed)} />
        <button className={`${styles.collisionCard} ${avoidance ? styles.collisionActive : ""}`} type="button" disabled={commandState.busy === "set_obstacle_avoidance" || status.obstacle_avoidance_transitioning} onClick={() => setCollision(!avoidance)}>
          <span className={styles.collisionRadar}><i /><b>◆</b></span>
          <span><strong>PERÍMETRO SEGURO</strong><small>{avoidance ? "Proteção confirmada · sensores ativos" : "Área não protegida · sensores inativos"}</small></span>
          <i className={styles.collisionSwitch}><b /></i>
        </button>
      </section>

      <section className={styles.physical}>
        <label>ACIONAMENTO FÍSICO</label>
        <div>
          <button className={posture === "standing" ? styles.postureActive : ""} type="button" onClick={() => setRobotPosture("standing")}>↑ LEVANTAR ROBÔ</button>
          <button className={posture === "lying" || posture === "sitting" ? styles.postureDown : ""} type="button" onClick={() => setRobotPosture("lying")}>↓ DEITAR ROBÔ</button>
        </div>
      </section>

      <section className={styles.gait}>
        <div><label>MODO DE MARCHA</label><span>SDK</span></div>
        <div>
          {[
            ["trot", "TROTTE"],
            ["stairs", "ESCADAS"],
            ["obstacles", "OBSTÁCULOS"],
          ].map(([value, label]) => (
            <button className={gaitMode === value ? styles.gaitActive : ""} type="button" key={value} onClick={() => setGaitMode(value)}>{label}</button>
          ))}
        </div>
      </section>

      <section className={styles.lighting}>
        <div className={styles.sectionTitle}><label>FARÓIS DO GO2</label><b>{lightsOn ? `${lightLevel}%` : "OFF"}</b></div>
        <button className={lightsOn ? styles.lightOn : ""} type="button" onClick={() => setLightsOn((value) => !value)}>✦ {lightsOn ? "ILUMINAÇÃO ATIVA" : "LIGAR ILUMINAÇÃO"}</button>
        <div className={styles.lightLevels}>
          {[25, 50, 75, 100].map((level) => (
            <button className={lightsOn && lightLevel === level ? styles.levelActive : ""} type="button" key={level} onClick={() => { setLightLevel(level); setLightsOn(level > 0); }}>{level}</button>
          ))}
        </div>
      </section>

      {commandState.message && <div className={styles.commandFeedback}>{commandState.message}</div>}

      <button className={styles.emergency} type="button" onClick={emergencyStop}>
        <span>■</span>
        <p><strong>PARADA DE EMERGÊNCIA</strong><small>Deitar robô e desarmar controle</small></p>
      </button>
    </aside>
  );
}

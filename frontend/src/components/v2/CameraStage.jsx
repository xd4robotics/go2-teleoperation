import { useEffect, useState } from "react";

import RobotCamera from "../RobotCamera";
import styles from "./CameraStage.module.css";

export default function CameraStage({ status, accessToken, liveKit }) {
  const [camera, setCamera] = useState("CAM 01 · FRONTAL");
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function updateFullscreen() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () => document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.getElementById("go2-teleoperation-view")?.requestFullscreen?.();
      try {
        await window.screen.orientation?.lock?.("landscape");
      } catch {
        // Alguns navegadores usam a rotação automática do aparelho.
      }
      return;
    }
    window.screen.orientation?.unlock?.();
    await document.exitFullscreen?.();
  }

  return (
    <article className={styles.stage} id="go2-camera-stage">
      <header>
        <div><span className={status.camera_connected ? styles.live : styles.offline}><i /> {status.camera_connected ? "LIVE FEED" : "FEED OFFLINE"}</span><select value={camera} onChange={(event) => setCamera(event.target.value)}><option>CAM 01 · FRONTAL</option><option>CAM 02 · TÉRMICA</option><option>CAM 03 · TRASEIRA</option></select></div>
        <div className={styles.signal}><span><i /><i /><i /><i /></span>{status.robot_online ? "LINK ATIVO" : "SEM SINAL"}</div>
      </header>

      <div className={styles.video}>
        <RobotCamera accessToken={accessToken} connected={Boolean(status.camera_connected)} liveKitRoom={liveKit?.room} liveKitConnectionState={liveKit?.connectionState} liveKitErrorMessage={liveKit?.errorMessage} onStreamingChange={setIsVideoPlaying} />
        <button className={styles.fullscreenToggle} type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Sair da tela cheia" : "Abrir câmera em tela cheia"}>⛶</button>
        {!isVideoPlaying && (
          <>
            <div className={styles.scanlines} /><div className={`${styles.videoNoise} ${!status.camera_connected ? styles.noiseOffline : ""}`} /><div className={styles.vignette} /><div className={styles.radarMesh} />
            <div className={styles.corners}><i /><i /><i /><i /></div>
            <div className={styles.horizon}><span /><b>{camera.includes("TÉRMICA") ? "THERMAL" : "OPTICAL"} · 1.0X</b><span /></div>
            {!status.camera_connected && <div className={styles.offlineLabel}><span>NO OPTICAL CARRIER</span><b>OFFLINE // SDK STANDBY</b></div>}
            <div className={styles.coordinates}><span>FRAME: ROBOT/BODY</span><span>LIDAR: {status.point_count || 0} PTS</span><b>{status.sdk_connected ? "SDK2 CONNECTED" : "SDK2 DISCONNECTED"}</b></div>
            <div className={styles.videoStatus}><span><i /> {status.camera_connected ? "INICIANDO STREAM" : "AGUARDANDO CÂMERA"}</span><p>GO2 WIDE CAMERA</p></div>
          </>
        )}
      </div>
    </article>
  );
}

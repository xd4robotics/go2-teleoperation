import { useEffect, useState } from "react";

import { getRobotCameraFrame } from "../services/api";
import { isLiveKitEnabled } from "../services/livekit";
import ArucoDetectionOverlay from "./ArucoDetectionOverlay";
import LiveKitRobotCamera from "./LiveKitRobotCamera";

const FRAME_INTERVAL_MS = 220;
const FRAME_RETRY_INTERVAL_MS = 1_500;
const FRAME_FAILURES_BEFORE_BACKOFF = 5;

function RobotCamera({
  accessToken,
  connected,
  liveKitRoom,
  liveKitConnectionState,
  liveKitErrorMessage,
  arucoMarker,
  arucoMarkerVisible,
  onStreamingChange,
}) {
  const detectionOverlay = (
    <ArucoDetectionOverlay
      marker={arucoMarker}
      visible={connected && arucoMarkerVisible}
    />
  );

  if (isLiveKitEnabled) {
    return (
      <>
        <LiveKitRobotCamera
          room={liveKitRoom}
          connectionState={liveKitConnectionState}
          errorMessage={liveKitErrorMessage}
          onStreamingChange={onStreamingChange}
        />
        {detectionOverlay}
      </>
    );
  }

  return (
    <>
      <PollingRobotCamera accessToken={accessToken} connected={connected} onStreamingChange={onStreamingChange} />
      {detectionOverlay}
    </>
  );
}

function PollingRobotCamera({ accessToken, connected, onStreamingChange }) {
  const [frameUrl, setFrameUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!accessToken || !connected) {
      onStreamingChange?.(false);
      return undefined;
    }

    let active = true;
    let timerId = null;
    let currentUrl = "";
    let consecutiveFailures = 0;

    async function loadFrame() {
      try {
        const blob = await getRobotCameraFrame(accessToken);
        if (!active) return;
        const nextUrl = URL.createObjectURL(blob);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
        consecutiveFailures = 0;
        setFrameUrl(nextUrl);
        setFailed(false);
      } catch {
        if (!active) return;
        consecutiveFailures += 1;
        setFailed(true);
      } finally {
        if (active) {
          // Com a câmera fora do ar, reduz o ritmo para poupar o backend.
          const delay =
            consecutiveFailures >= FRAME_FAILURES_BEFORE_BACKOFF
              ? FRAME_RETRY_INTERVAL_MS
              : FRAME_INTERVAL_MS;
          timerId = window.setTimeout(loadFrame, delay);
        }
      }
    }

    loadFrame();
    return () => {
      active = false;
      onStreamingChange?.(false);
      window.clearTimeout(timerId);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [accessToken, connected, onStreamingChange]);

  if (!connected || !frameUrl) {
    return (
      <div className="stream-empty">
        <span className="stream-empty-icon">◉</span>
        <strong>{failed ? "Câmera temporariamente indisponível" : "Aguardando câmera"}</strong>
        <small>A imagem aparecerá quando o robô estiver transmitindo.</small>
      </div>
    );
  }

  return (
    <img
      className="robot-camera-frame"
      src={frameUrl}
      alt="Transmissão atual da câmera frontal do Go2"
      onLoad={() => onStreamingChange?.(true)}
      onError={() => onStreamingChange?.(false)}
    />
  );
}

export default RobotCamera;

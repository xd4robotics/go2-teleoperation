import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent } from "livekit-client";

import { getLiveKitConnection, isLiveKitEnabled } from "./livekit";
import {
  decodeLiveKitPointCloud,
  decodeLiveKitTelemetry,
  POINT_CLOUD_TOPIC,
  TELEMETRY_TOPIC,
} from "./livekitPointCloud";

const CLOUD_VOXEL_SIZE_METERS = 0.035;
const MAX_ACCUMULATED_POINTS = 18_000;
// Este participante mantém a ponte WebRTC bidirecional com o peer nativo do
// Go2. Sua presença confirma que fala e escuta estão realmente disponíveis.
const AUDIO_BRIDGE_IDENTITY = "go2-ambient-audio";
const COMMAND_GATEWAY_IDENTITY = "go2-command-gateway";

export function hasAudioBridge(room) {
  return Boolean(room?.remoteParticipants?.has(AUDIO_BRIDGE_IDENTITY));
}

export function hasCommandGateway(room) {
  return Boolean(room?.remoteParticipants?.has(COMMAND_GATEWAY_IDENTITY));
}

function mergePointCloud(voxels, nextPoints) {
  for (let index = 0; index + 2 < nextPoints.length; index += 3) {
    const x = Number(nextPoints[index]);
    const y = Number(nextPoints[index + 1]);
    const z = Number(nextPoints[index + 2]);
    if (![x, y, z].every(Number.isFinite)) continue;
    const key = `${Math.round(x / CLOUD_VOXEL_SIZE_METERS)}:${Math.round(
      y / CLOUD_VOXEL_SIZE_METERS,
    )}:${Math.round(z / CLOUD_VOXEL_SIZE_METERS)}`;
    voxels.set(key, [x, y, z]);
  }

  while (voxels.size > MAX_ACCUMULATED_POINTS) {
    voxels.delete(voxels.keys().next().value);
  }

  return [...voxels.values()].flat();
}

export function useLiveKitRobot(accessToken) {
  const [room, setRoom] = useState(null);
  const [connectionState, setConnectionState] = useState(
    isLiveKitEnabled ? "connecting" : "disabled",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [points, setPoints] = useState([]);
  const [telemetry, setTelemetry] = useState(null);
  const [audioBridgeConnected, setAudioBridgeConnected] = useState(false);
  const [commandGatewayConnected, setCommandGatewayConnected] = useState(false);
  const latestTelemetryAtRef = useRef(0);
  const previousMapPointCountRef = useRef(0);
  const pointCloudVoxelsRef = useRef(new Map());

  useEffect(() => {
    if (!isLiveKitEnabled || !accessToken) return undefined;

    let active = true;
    const nextRoom = new Room({ adaptiveStream: false });
    const pointCloudVoxels = pointCloudVoxelsRef.current;

    function handleData(payload, _participant, _kind, topic) {
      if (!active) return;

      const decodedPoints = decodeLiveKitPointCloud(payload);
      if (topic === POINT_CLOUD_TOPIC || decodedPoints) {
        if (decodedPoints) {
          setPoints(mergePointCloud(pointCloudVoxels, decodedPoints));
        }
        return;
      }

      const decodedTelemetry = decodeLiveKitTelemetry(payload);
      if (topic === TELEMETRY_TOPIC || decodedTelemetry?.robot_id === "primary") {
        if (!decodedTelemetry) return;
        const capturedAt = Number(decodedTelemetry.captured_at_ms || 0);
        if (latestTelemetryAtRef.current && capturedAt < latestTelemetryAtRef.current) {
          const clockMovedBackAfterRestart =
            latestTelemetryAtRef.current - capturedAt > 30_000;
          if (!clockMovedBackAfterRestart) return;
          latestTelemetryAtRef.current = 0;
          previousMapPointCountRef.current = 0;
          pointCloudVoxels.clear();
          setPoints([]);
        }
        const nextMapPointCount = Number(decodedTelemetry.point_count || 0);
        const previousMapPointCount = previousMapPointCountRef.current;
        if (
          nextMapPointCount === 0 ||
          (previousMapPointCount > 500 && nextMapPointCount < previousMapPointCount * 0.35)
        ) {
          pointCloudVoxels.clear();
          setPoints([]);
        }
        previousMapPointCountRef.current = nextMapPointCount;
        if (capturedAt) latestTelemetryAtRef.current = capturedAt;
        // Os pacotes podem ser incrementais. Preservar os últimos campos
        // válidos evita alternância visual quando métricas diferentes chegam
        // em instantes distintos ou há mais de um painel conectado.
        setTelemetry((current) => ({ ...(current || {}), ...decodedTelemetry }));
      }
    }

    let retryTimerId = null;
    let retryDelayMs = 3_000;

    function updateAudioBridge() {
      if (!active) return;
      setAudioBridgeConnected(hasAudioBridge(nextRoom));
      setCommandGatewayConnected(hasCommandGateway(nextRoom));
    }

    nextRoom.on(RoomEvent.DataReceived, handleData);
    nextRoom.on(RoomEvent.ParticipantConnected, updateAudioBridge);
    nextRoom.on(RoomEvent.ParticipantDisconnected, updateAudioBridge);
    nextRoom.on(RoomEvent.Disconnected, () => {
      if (!active) return;
      setAudioBridgeConnected(false);
      setCommandGatewayConnected(false);
      setTelemetry(null);
      latestTelemetryAtRef.current = 0;
      previousMapPointCountRef.current = 0;
      setConnectionState("disconnected");
      // O cliente desistiu das reconexões transparentes; recomeça do zero
      // com credenciais novas em vez de deixar o painel morto.
      window.clearTimeout(retryTimerId);
      retryTimerId = window.setTimeout(connect, retryDelayMs);
      retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
    });
    nextRoom.on(RoomEvent.Reconnecting, () => {
      if (active) setConnectionState("connecting");
    });
    nextRoom.on(RoomEvent.Reconnected, () => {
      if (active) setConnectionState("connected");
    });

    async function connect() {
      try {
        const credentials = await getLiveKitConnection(accessToken);
        if (!active) return;
        setConnectionState("connecting");
        setErrorMessage("");
        await nextRoom.connect(credentials.serverUrl, credentials.participantToken, {
          autoSubscribe: true,
        });
        if (active) {
          setRoom(nextRoom);
          setConnectionState("connected");
          updateAudioBridge();
          retryDelayMs = 3_000;
        }
      } catch (error) {
        if (!active) return;
        setErrorMessage(error.message);
        setConnectionState("error");
        fetch("/api/client-diagnostics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: error?.message, state: nextRoom.state }),
        }).catch(() => {});
        // Nova tentativa automática com espera progressiva (máximo 30 s).
        retryTimerId = window.setTimeout(connect, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 30_000);
      }
    }

    connect();
    return () => {
      active = false;
      window.clearTimeout(retryTimerId);
      latestTelemetryAtRef.current = 0;
      previousMapPointCountRef.current = 0;
      pointCloudVoxels.clear();
      nextRoom.removeAllListeners();
      nextRoom.disconnect();
      setRoom(null);
      setAudioBridgeConnected(false);
      setCommandGatewayConnected(false);
    };
  }, [accessToken]);

  return {
    room,
    connectionState,
    errorMessage,
    points,
    telemetry,
    audioBridgeConnected,
    commandGatewayConnected,
  };
}

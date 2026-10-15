import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, Track } from "livekit-client";

const CONNECTION_LABELS = {
  connected: "Conexão estabelecida",
  disconnected: "Transmissão desconectada · reconectando",
  error: "Transmissão indisponível",
};

function LiveKitRobotCamera({ room, connectionState, errorMessage, onStreamingChange }) {
  const videoRef = useRef(null);
  const attachedTrackRef = useRef(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mediaError, setMediaError] = useState("");

  useEffect(() => {
    onStreamingChange?.(isStreaming);
    return () => onStreamingChange?.(false);
  }, [isStreaming, onStreamingChange]);

  const startPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video || !attachedTrackRef.current) return;
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    const result = video.play();
    if (result?.catch) {
      result.catch(() => {
        // A troca do MediaStream pode interromper temporariamente play().
        // O efeito abaixo tenta novamente sem exigir interação do operador.
        setIsStreaming(false);
      });
    }
  }, []);

  useEffect(() => {
    if (!hasVideoTrack || isStreaming) return undefined;

    startPlayback();
    const retryTimer = window.setInterval(startPlayback, 800);
    return () => window.clearInterval(retryTimer);
  }, [hasVideoTrack, isStreaming, startPlayback]);

  useEffect(() => {
    if (!room) return undefined;

    function detachCurrentTrack() {
      if (attachedTrackRef.current && videoRef.current) {
        attachedTrackRef.current.detach(videoRef.current);
      }
      attachedTrackRef.current = null;
      setHasVideoTrack(false);
      setIsStreaming(false);
      setMediaError("");
    }

    function handleTrackSubscribed(track) {
      if (track.kind !== Track.Kind.Video || !videoRef.current) return;
      detachCurrentTrack();
      videoRef.current.muted = true;
      videoRef.current.defaultMuted = true;
      videoRef.current.autoplay = true;
      videoRef.current.playsInline = true;
      attachedTrackRef.current = track;
      track.attach(videoRef.current);
      setHasVideoTrack(true);
      setMediaError("");
      window.requestAnimationFrame(startPlayback);
    }

    function handleTrackUnsubscribed(track) {
      if (track !== attachedTrackRef.current) return;
      detachCurrentTrack();
    }

    function subscribePublication(publication) {
      if (publication.kind !== Track.Kind.Video) return;
      publication.setSubscribed?.(true);
      if (publication.track) handleTrackSubscribed(publication.track);
    }

    function subscribeAvailableCamera() {
      const participants = [...room.remoteParticipants.values()].sort((first) =>
        first.identity === "go2-camera" ? -1 : 0,
      );
      for (const participant of participants) {
        for (const publication of participant.trackPublications.values()) {
          if (publication.kind !== Track.Kind.Video) continue;
          subscribePublication(publication);
          return;
        }
      }
    }

    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
    room.on(RoomEvent.TrackPublished, subscribePublication);
    room.on(RoomEvent.ParticipantConnected, subscribeAvailableCamera);
    subscribeAvailableCamera();

    return () => {
      detachCurrentTrack();
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
      room.off(RoomEvent.TrackPublished, subscribePublication);
      room.off(RoomEvent.ParticipantConnected, subscribeAvailableCamera);
    };
  }, [room, startPlayback]);

  return (
    <div className="livekit-camera">
      <video
        ref={videoRef}
        className={
          hasVideoTrack
            ? "robot-camera-frame"
            : "robot-camera-frame is-waiting"
        }
        autoPlay
        muted
        playsInline
        onCanPlay={startPlayback}
        onPlaying={() => {
          setIsStreaming(true);
          setMediaError("");
        }}
        onPause={() => setIsStreaming(false)}
        onWaiting={() => setIsStreaming(false)}
        onError={() => {
          setIsStreaming(false);
          setMediaError("Reiniciando a câmera automaticamente...");
        }}
      />

      {(!hasVideoTrack || mediaError) && (
        <div className="stream-empty">
          <span className="stream-empty-icon">◉</span>
          <strong>
            {mediaError ||
              CONNECTION_LABELS[connectionState] ||
              "Conectando à câmera"}
          </strong>
          <small>
            {mediaError
              ? "A reprodução será retomada automaticamente."
              : errorMessage ||
              "Aguardando o robô transmitir a câmera."}
          </small>
        </div>
      )}

      {hasVideoTrack && !isStreaming && !mediaError && (
        <span className="camera-buffering">Iniciando câmera automaticamente...</span>
      )}
    </div>
  );
}

export default LiveKitRobotCamera;

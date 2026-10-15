import { readArucoOverlay } from "../services/arucoOverlay";

function ArucoDetectionOverlay({ marker, visible }) {
  const overlay = readArucoOverlay(marker, visible);
  if (!overlay) return null;

  const {
    frameWidth,
    frameHeight,
    x,
    y,
    width,
    height,
    label,
    labelX,
    labelY,
    labelWidth,
    labelHeight,
  } = overlay;

  return (
    <svg
      className="aruco-detection-overlay"
      viewBox={`0 0 ${frameWidth} ${frameHeight}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={`Tag ${label} detectada pela câmera`}
    >
      <title>{`Tag ${label} detectada`}</title>
      <rect
        className="aruco-detection-box"
        x={x}
        y={y}
        width={width}
        height={height}
        rx="2"
      />
      <rect
        className="aruco-detection-label-background"
        x={labelX}
        y={labelY}
        width={labelWidth}
        height={labelHeight}
        rx="3"
      />
      <text
        className="aruco-detection-label"
        x={labelX + 8}
        y={labelY + labelHeight * 0.68}
        fontSize={labelHeight * 0.52}
      >
        {label}
      </text>
    </svg>
  );
}

export default ArucoDetectionOverlay;

import { useEffect, useRef, useState } from "react";

function quaternionYaw(pose) {
  if (!pose) return 0;
  const siny = 2 * (pose.qw * pose.qz + pose.qx * pose.qy);
  const cosy = 1 - 2 * (pose.qy * pose.qy + pose.qz * pose.qz);
  return Math.atan2(siny, cosy);
}

function PointCloudMap({ points, pose }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [yaw, setYaw] = useState(-0.65);
  const [pitch, setPitch] = useState(-0.55);
  const [zoom, setZoom] = useState(1.12);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d", { alpha: true });
    let animationFrame = 0;

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);
      if (!points || points.length < 3) return;

      const cloud = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let index = 0; index < points.length; index += 3) {
        const x = Number(points[index]);
        const y = Number(points[index + 1]);
        const z = Number(points[index + 2]);
        if (![x, y, z].every(Number.isFinite)) continue;
        cloud.push({ x, y, z });
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }
      if (!cloud.length) return;

      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const extent = Math.max(maxX - minX, maxY - minY, 2);
      const scale = (Math.min(rect.width, rect.height) * 0.86 * zoom) / extent;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);

      function project(worldX, worldY, worldZ) {
        const x = worldX - centerX;
        const y = worldY - centerY;
        const rotatedX = x * cosY - y * sinY;
        const rotatedY = x * sinY + y * cosY;
        const projectedY = rotatedY * cosP - worldZ * sinP;
        return {
          x: rect.width / 2 + rotatedX * scale,
          y: rect.height / 2 - projectedY * scale,
          depth: rotatedY * sinP + worldZ * cosP,
          z: worldZ,
        };
      }

      const rawGridStep = extent / 8;
      const gridMagnitude = 10 ** Math.floor(Math.log10(rawGridStep));
      const gridRatio = rawGridStep / gridMagnitude;
      const gridStep = (gridRatio < 2 ? 1 : gridRatio < 5 ? 2 : 5) * gridMagnitude;
      const gridRadius = Math.ceil(extent / gridStep / 2) + 1;
      context.lineWidth = 1;
      for (let offset = -gridRadius; offset <= gridRadius; offset += 1) {
        const value = offset * gridStep;
        const xStart = project(centerX + value, centerY - extent, minZ);
        const xEnd = project(centerX + value, centerY + extent, minZ);
        const yStart = project(centerX - extent, centerY + value, minZ);
        const yEnd = project(centerX + extent, centerY + value, minZ);
        context.strokeStyle = offset === 0
          ? "rgba(117, 214, 156, .25)"
          : "rgba(42, 169, 224, .09)";
        context.beginPath();
        context.moveTo(xStart.x, xStart.y);
        context.lineTo(xEnd.x, xEnd.y);
        context.stroke();
        context.beginPath();
        context.moveTo(yStart.x, yStart.y);
        context.lineTo(yEnd.x, yEnd.y);
        context.stroke();
      }

      const projected = cloud.map((point) => project(point.x, point.y, point.z));
      projected.sort((first, second) => first.depth - second.depth);

      const heightExtent = Math.max(maxZ - minZ, 0.25);
      const pointSize = Math.max(2.35, Math.min(4.2, 76 / Math.sqrt(projected.length)));
      const minimumDepth = projected[0]?.depth || 0;
      const maximumDepth = projected[projected.length - 1]?.depth || minimumDepth + 1;
      const depthExtent = Math.max(maximumDepth - minimumDepth, 0.1);
      for (const point of projected) {
        const height = Math.max(0, Math.min(1, (point.z - minZ) / heightExtent));
        const depth = (point.depth - minimumDepth) / depthExtent;
        const hue = 205 - height * 160;
        const lightness = 54 + height * 12;
        const alpha = 0.58 + depth * 0.36;
        context.fillStyle = `hsla(${hue}, 82%, ${lightness}%, ${alpha})`;
        context.fillRect(
          point.x - pointSize / 2,
          point.y - pointSize / 2,
          pointSize,
          pointSize,
        );
      }

      if (pose) {
        const robot = project(pose.x, pose.y, pose.z);
        const heading = quaternionYaw(pose);
        const direction = project(
          pose.x + Math.cos(heading) * 0.35,
          pose.y + Math.sin(heading) * 0.35,
          pose.z,
        );
        context.strokeStyle = "#eaff4f";
        context.fillStyle = "#eaff4f";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(robot.x, robot.y);
        context.lineTo(direction.x, direction.y);
        context.stroke();
        context.beginPath();
        context.arc(robot.x, robot.y, 5, 0, Math.PI * 2);
        context.fill();
        context.font = "700 9px Inter, sans-serif";
        context.fillText("GO2", robot.x + 8, robot.y - 7);
      }
    }

    function scheduleDraw() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(draw);
    }

    scheduleDraw();
    const observer = new ResizeObserver(scheduleDraw);
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [pitch, points, pose, yaw, zoom]);

  function handlePointerDown(event) {
    dragRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragRef.current) return;
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    setYaw((current) => current + deltaX * 0.008);
    setPitch((current) => Math.max(-1.35, Math.min(0.1, current + deltaY * 0.006)));
    dragRef.current = { x: event.clientX, y: event.clientY };
  }

  function stopDragging() {
    dragRef.current = null;
  }

  function handleWheel(event) {
    event.preventDefault();
    setZoom((current) =>
      Math.max(0.35, Math.min(4, current * Math.exp(-event.deltaY * 0.001))),
    );
  }

  return (
    <div
      className="point-cloud-view"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} aria-label="Nuvem de pontos 3D do Go2" />
      {points?.length >= 3 && (
        <span className="map-point-count">
          {Math.floor(points.length / 3).toLocaleString("pt-BR")} pontos ao vivo
        </span>
      )}
      {(!points || points.length === 0) && (
        <div className="stream-empty map-empty-state">
          <span className="stream-empty-icon">⌁</span>
          <strong>Aguardando pontos do LiDAR</strong>
          <small>O mapa aparecerá quando o LIO publicar uma nuvem estável.</small>
        </div>
      )}
      <span className="map-interaction-hint">Arraste para girar · scroll para zoom</span>
    </div>
  );
}

export default PointCloudMap;

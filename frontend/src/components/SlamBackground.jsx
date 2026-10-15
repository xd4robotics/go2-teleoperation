import { useEffect, useRef } from "react";

import oracleMarkUrl from "../../logos/oraclefundo.png";
import xd4MarkUrl from "../../logos/iconexd4.svg";

function SlamBackground({ className = "", variant = "default" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frameId;
    let width = 0;
    let height = 0;
    let particles = [];
    let brandTemplates = { xd4: [], oracle: [] };
    let disposed = false;

    function loadImage(source) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = source;
      });
    }

    function sampleMark(image, targetCount) {
      const sampleSize = 180;
      const sampleCanvas = document.createElement("canvas");
      const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      const scale = Math.min(sampleSize / image.naturalWidth, sampleSize / image.naturalHeight) * 0.92;
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      sampleContext.drawImage(
        image,
        (sampleSize - drawWidth) / 2,
        (sampleSize - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      const pixels = sampleContext.getImageData(0, 0, sampleSize, sampleSize).data;
      const candidates = [];
      for (let y = 1; y < sampleSize; y += 1) {
        for (let x = 1; x < sampleSize; x += 1) {
          if (pixels[(y * sampleSize + x) * 4 + 3] > 48) {
            candidates.push({
              x: x / sampleSize - 0.5,
              y: y / sampleSize - 0.5,
            });
          }
        }
      }
      if (!candidates.length) return [];
      const sampleCount = Math.min(targetCount, candidates.length);
      for (let index = 0; index < sampleCount; index += 1) {
        const randomIndex = index + Math.floor(Math.random() * (candidates.length - index));
        [candidates[index], candidates[randomIndex]] = [candidates[randomIndex], candidates[index]];
      }
      return candidates.slice(0, sampleCount).map((point) => {
        return {
          x: point.x + (Math.random() - 0.5) * 0.0018,
          y: point.y + (Math.random() - 0.5) * 0.0018,
        };
      });
    }

    async function loadBrandTemplates() {
      if (variant !== "login") return;
      try {
        const [xd4Mark, oracleMark] = await Promise.all([
          loadImage(xd4MarkUrl),
          loadImage(oracleMarkUrl),
        ]);
        if (disposed) return;
        brandTemplates = {
          xd4: sampleMark(xd4Mark, 2300),
          oracle: sampleMark(oracleMark, 2300),
        };
        buildParticles();
      } catch {
        // A nuvem ambiente continua funcionando caso um asset nao carregue.
      }
    }

    function buildParticles() {
      const count = variant === "login"
        ? Math.min(2200, Math.max(width < 640 ? 700 : 1200, Math.floor((width * height) / 900)))
        : Math.min(3400, Math.max(1500, Math.floor((width * height) / 620)));
      particles = Array.from({ length: count }, (_, index) => {
        const depth = Math.pow(Math.random(), 0.78);
        const surface = Math.random();
        const spread = 0.14 + depth * 0.94;
        let normalizedX;
        let normalizedY;

        if (surface < 0.58) {
          // Piso visto em perspectiva: denso perto do sensor e estreito no horizonte.
          normalizedX = (Math.random() - 0.5) * 2 * spread;
          normalizedY = 0.51
            + Math.pow(depth, 1.52) * 0.47
            + Math.sin(normalizedX * 7.5 + depth * 5) * 0.011
            + (Math.random() - 0.5) * 0.018;
        } else if (surface < 0.78) {
          // Planos laterais incompletos sugerem paredes detectadas pelo LiDAR.
          const side = index % 2 === 0 ? -1 : 1;
          normalizedX = side * (0.2 + depth * 0.82) + (Math.random() - 0.5) * 0.035;
          normalizedY = 0.2 + Math.random() * 0.38 + depth * 0.14;
        } else if (surface < 0.94) {
          // Pequenos volumes interrompem os planos e evitam uma nuvem artificialmente lisa.
          const centers = [-0.48, 0.08, 0.5];
          const center = centers[index % centers.length];
          const angle = Math.random() * Math.PI * 2;
          const radius = 0.025 + Math.random() * 0.09;
          normalizedX = center * (0.42 + depth * 0.64) + Math.cos(angle) * radius;
          normalizedY = 0.42 + depth * 0.25 + Math.sin(angle) * radius * 0.72;
        } else {
          // Retornos esparsos acima da linha principal, comuns em leituras reais.
          normalizedX = (Math.random() - 0.5) * 1.65;
          normalizedY = 0.28 + Math.random() * 0.26;
        }

        return {
          x: width * (0.5 + normalizedX * 0.48),
          y: height * normalizedY,
          z: depth,
          phase: Math.random() * Math.PI * 2,
          drift: 0,
          tone: (index + Math.floor(depth * 7)) % 3 === 0 ? "red" : "blue",
          brand: false,
        };
      });

      if (variant === "login" && brandTemplates.xd4.length && brandTemplates.oracle.length) {
        const compact = width < 640;
        const compactPortrait = compact && height > width;
        const landscapeCompact = height < 560 && width > height;
        const tablet = width >= 640 && width < 1200;
        const robotLoginLayout = width >= 1200 || (width >= 480 && width > height);
        const densityStep = compact ? 2 : 1;
        const shortSide = Math.min(width, height);
        const marks = [
          {
            points: brandTemplates.xd4,
            centerX: compactPortrait ? 0.25 : robotLoginLayout ? (width >= 1200 ? 0.12 : 0.11) : compact ? 0.16 : tablet ? 0.17 : 0.18,
            centerY: compactPortrait ? 0.82 : robotLoginLayout ? 0.72 : 0.54,
            size: shortSide * (compactPortrait ? 0.34 : robotLoginLayout ? (width >= 1200 ? 0.44 : landscapeCompact ? 0.34 : 0.38) : compact ? 0.38 : tablet ? 0.48 : 0.48),
            tone: "blue",
          },
          {
            points: brandTemplates.oracle,
            centerX: compactPortrait ? 0.75 : robotLoginLayout ? (width >= 1200 ? 0.12 : 0.11) : compact ? 0.84 : tablet ? 0.83 : 0.82,
            centerY: compactPortrait ? 0.2 : robotLoginLayout ? 0.3 : 0.54,
            size: shortSide * (compactPortrait ? 0.4 : robotLoginLayout ? (width >= 1200 ? 0.48 : landscapeCompact ? 0.38 : 0.42) : compact ? 0.48 : tablet ? 0.52 : 0.52),
            tone: "red",
          },
        ];
        marks.forEach((mark) => {
          mark.points.forEach((point, index) => {
            if (index % densityStep !== 0) return;
            particles.push({
              x: width * mark.centerX + point.x * mark.size,
              y: height * mark.centerY + point.y * mark.size,
              z: 0.38 + Math.random() * 0.62,
              phase: Math.random() * Math.PI * 2,
              drift: 0,
              tone: mark.tone,
              brand: true,
            });
          });

          // Uma pequena dispersao preserva a leitura de nuvem de pontos sem
          // transformar as marcas em manchas ou competir com o formulario.
          const haloCount = compactPortrait ? 34 : compact ? 26 : tablet ? 54 : 76;
          for (let index = 0; index < haloCount; index += 1) {
            const angle = Math.random() * Math.PI * 2;
            const radius = mark.size * (0.42 + Math.pow(Math.random(), 0.7) * 0.24);
            particles.push({
              x: width * mark.centerX + Math.cos(angle) * radius,
              y: height * mark.centerY + Math.sin(angle) * radius * 0.68,
              z: 0.2 + Math.random() * 0.55,
              phase: Math.random() * Math.PI * 2,
              drift: 0,
              tone: mark.tone,
              brand: false,
              brandHalo: true,
            });
          }
        });
      }
    }

    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildParticles();
    }

    function drawGrid() {
      if (variant === "login") return;
      context.save();
      context.translate(width / 2, height * 0.71);
      context.strokeStyle = "rgba(42, 169, 224, 0.07)";
      context.lineWidth = 1;
      for (let row = 0; row < 9; row += 1) {
        const y = row * row * 5.5;
        context.beginPath();
        context.moveTo(-width, y);
        context.lineTo(width, y);
        context.stroke();
      }
      for (let column = -12; column <= 12; column += 1) {
        context.beginPath();
        context.moveTo(column * 34, 0);
        context.lineTo(column * 120, height * 0.55);
        context.stroke();
      }
      context.restore();
    }

    function render(time) {
      context.clearRect(0, 0, width, height);
      drawGrid();
      const darkDashboard = variant !== "login"
        && document.documentElement.dataset.theme === "dark";
      particles.forEach((particle, index) => {
        if (darkDashboard && index % 2 !== 0) return;
        particle.x += particle.drift;
        if (particle.x > width + 5) particle.x = -5;
        const waveScale = particle.brand
          ? 0.12 + particle.z * 0.24
          : variant === "login" ? 0.7 + particle.z * 1.25 : 0.55 + particle.z * 1.5;
        const wave = Math.sin(time * 0.0007 + particle.phase) * waveScale;
        const pulse = 0.34 + particle.z * 0.38 + Math.sin(time * 0.001 + particle.phase) * 0.1;
        const alpha = particle.brand
          ? Math.min(0.94, pulse + 0.34)
          : particle.brandHalo
          ? Math.min(0.5, pulse * 0.58)
          : variant === "login" ? Math.min(0.82, pulse + 0.1)
          : Math.min(0.9, pulse + 0.12);
        const renderedAlpha = darkDashboard ? alpha * 0.72 : alpha;
        if (particle.tone === "red") {
          context.fillStyle = `rgba(199, 70, 52, ${renderedAlpha})`;
        } else {
          context.fillStyle = `rgba(42, 169, 224, ${renderedAlpha})`;
        }
        const size = particle.brand
          ? 0.85 + particle.z * 1.35
          : variant === "login"
          ? 0.65 + particle.z * 1.25
          : 0.72 + particle.z * 1.45;
        let drawX;
        let drawY;
        if (variant === "login") {
          if (particle.brand) {
            drawX = particle.x + Math.sin(time * 0.00038 + particle.phase) * 0.28;
            drawY = particle.y + wave;
          } else {
            const angle = Math.sin(time * 0.00016) * 0.018;
            const centerX = width / 2;
            const centerY = height * 0.56;
            const offsetX = particle.x - centerX;
            const offsetY = particle.y - centerY;
            drawX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
              + Math.sin(time * 0.00045 + particle.phase) * (0.4 + particle.z * 1.2);
            drawY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle) + wave;
          }
        } else {
          const angle = Math.sin(time * 0.00013) * 0.014;
          const centerX = width / 2;
          const centerY = height * 0.58;
          const offsetX = particle.x - centerX;
          const offsetY = particle.y - centerY;
          drawX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
            + Math.sin(time * 0.00042 + particle.phase) * (0.5 + particle.z * 1.6);
          drawY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle) + wave;
        }
        context.fillRect(drawX, drawY, size, size);
      });
      frameId = window.requestAnimationFrame(render);
    }

    resize();
    loadBrandTemplates();
    window.addEventListener("resize", resize);
    frameId = window.requestAnimationFrame(render);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  return <canvas className={`slam-background ${className}`.trim()} ref={canvasRef} aria-hidden="true" />;
}

export default SlamBackground;

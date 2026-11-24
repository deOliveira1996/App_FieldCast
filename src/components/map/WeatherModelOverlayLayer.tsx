import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import {
  getWeatherOverlayRgba,
  interpolateGridValueAtPoint,
  type MapModelMode,
  type WeatherGridPoint,
  type WeatherMapLayerId,
} from '../../services/weatherGridService';

export interface WeatherModelOverlayLayerProps {
  layerId: WeatherMapLayerId;
  modelMode: MapModelMode;
  points: ReadonlyArray<WeatherGridPoint>;
  opacity?: number;
  animateFlow?: boolean;
}

interface FlowParticle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

function drawArrowVector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  directionFromDeg: number,
  speedKmh: number,
  color: string,
): void {
  // Meteorological wind direction is where wind comes FROM; arrow points where it blows TO
  const blowToRad = (((directionFromDeg + 180) % 360) * Math.PI) / 180;
  const dx = Math.sin(blowToRad);
  const dy = -Math.cos(blowToRad);
  const len = Math.max(14, Math.min(28, 12 + speedKmh * 0.28));

  const startX = x - (dx * len) / 2;
  const startY = y - (dy * len) / 2;
  const endX = x + (dx * len) / 2;
  const endY = y + (dy * len) / 2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  const headLen = 5.5;
  const angle = Math.atan2(endY - startY, endX - startX);
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLen * Math.cos(angle - Math.PI / 6),
    endY - headLen * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    endX - headLen * Math.cos(angle + Math.PI / 6),
    endY - headLen * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Renders the meteorological model field (heatmap + wind vectors + optional flow particles)
 * synchronized with Leaflet's pan/zoom coordinates without requiring paid tile servers.
 */
export const WeatherModelOverlayLayer: React.FC<WeatherModelOverlayLayerProps> = ({
  layerId,
  modelMode,
  points,
  opacity = 0.72,
  animateFlow = true,
}) => {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (layerId === 'none') {
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
        canvasRef.current = null;
      }
      return;
    }

    let container: HTMLElement;
    try {
      container = map.getContainer();
    } catch {
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'weather-model-canvas';
    canvas.dataset.weatherModel = modelMode;
    canvas.dataset.weatherLayer = layerId;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '220';
    canvasRef.current = canvas;
    container.appendChild(canvas);

    let ctx: CanvasRenderingContext2D | null = null;
    const isJsdom =
      typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!isJsdom) {
      try {
        ctx = canvas.getContext('2d');
      } catch {
        ctx = null;
      }
    }

    let rafId: number | null = null;
    let isDisposed = false;

    const particles: FlowParticle[] = [];
    const initParticles = (width: number, height: number) => {
      particles.length = 0;
      const count = Math.min(48, Math.max(18, Math.round((width * height) / 14000)));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          age: Math.floor(Math.random() * 60),
          maxAge: 50 + Math.floor(Math.random() * 45),
        });
      }
    };

    const drawStaticField = (): { width: number; height: number } => {
      const size =
        typeof map.getSize === 'function'
          ? map.getSize()
          : L.point(container.clientWidth || 640, container.clientHeight || 360);
      const width = Math.max(1, size.x || container.clientWidth || 640);
      const height = Math.max(1, size.y || container.clientHeight || 360);

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        initParticles(width, height);
      }

      if (!ctx || points.length === 0) {
        return { width, height };
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Coarse interpolated meteorological heat cells (fast & crisp)
      const cellSize = 36;
      for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
          let latLng: L.LatLng;
          try {
            latLng = map.containerPointToLatLng(L.point(x + cellSize / 2, y + cellSize / 2));
          } catch {
            continue;
          }
          const sample = interpolateGridValueAtPoint(
            points,
            latLng.lat,
            latLng.lng,
            layerId,
          );
          const [r, g, b, a] = getWeatherOverlayRgba(layerId, sample.value);
          if (a > 0) {
            const finalAlpha = Math.max(0.03, Math.min(0.68, (a / 255) * opacity));
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha.toFixed(3)})`;
            ctx.fillRect(x, y, cellSize + 1, cellSize + 1);
          }
        }
      }

      // 2. Vector arrows (for wind / waves) or grid numerical badges (for temp / rain)
      const stepX = Math.max(64, Math.floor(width / 8));
      const stepY = Math.max(60, Math.floor(height / 5));

      for (let y = Math.floor(stepY * 0.55); y < height - 20; y += stepY) {
        for (let x = Math.floor(stepX * 0.55); x < width - 20; x += stepX) {
          let latLng: L.LatLng;
          try {
            latLng = map.containerPointToLatLng(L.point(x, y));
          } catch {
            continue;
          }
          const sample = interpolateGridValueAtPoint(
            points,
            latLng.lat,
            latLng.lng,
            layerId,
          );

          if (layerId === 'wind' || layerId === 'waves') {
            if (sample.windDirectionDeg !== null) {
              const speed = sample.value ?? 8;
              drawArrowVector(
                ctx,
                x,
                y,
                sample.windDirectionDeg,
                layerId === 'waves' ? speed * 8 : speed,
                'rgba(15, 23, 42, 0.62)',
              );
            }
          } else if (sample.value !== null) {
            const text =
              layerId === 'temperature'
                ? `${Math.round(sample.value)}°`
                : `${sample.value.toFixed(1)}`;
            ctx.save();
            ctx.font = '700 10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(x - 15, y - 8, 30, 16);
            ctx.fillStyle = '#0f172a';
            ctx.fillText(text, x, y);
            ctx.restore();
          }
        }
      }

      return { width, height };
    };

    const { width: initialW, height: initialH } = drawStaticField();
    if (particles.length === 0) {
      initParticles(initialW, initialH);
    }

    const canAnimate =
      animateFlow &&
      (layerId === 'wind' || layerId === 'waves') &&
      Boolean(ctx) &&
      points.length > 0 &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function';

    let lastFrameMs = 0;
    const renderLoop = (nowMs: number) => {
      if (isDisposed || !ctx) return;

      if (nowMs - lastFrameMs >= 45) {
        lastFrameMs = nowMs;
        const { width, height } = drawStaticField();

        ctx.save();
        ctx.lineCap = 'round';
        for (const p of particles) {
          let latLng: L.LatLng;
          try {
            latLng = map.containerPointToLatLng(L.point(p.x, p.y));
          } catch {
            continue;
          }
          const sample = interpolateGridValueAtPoint(
            points,
            latLng.lat,
            latLng.lng,
            'wind',
          );
          const dir = sample.windDirectionDeg;
          const speed = sample.value ?? 10;

          if (dir !== null) {
            const blowToRad = (((dir + 180) % 360) * Math.PI) / 180;
            const stepPx = Math.max(1.2, Math.min(4.8, 0.9 + speed * 0.08));
            const nextX = p.x + Math.sin(blowToRad) * stepPx;
            const nextY = p.y - Math.cos(blowToRad) * stepPx;

            const lifeAlpha =
              Math.sin((p.age / p.maxAge) * Math.PI) * 0.65;
            ctx.strokeStyle = `rgba(255, 255, 255, ${Math.max(0.12, lifeAlpha).toFixed(2)})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(nextX, nextY);
            ctx.stroke();

            p.x = nextX;
            p.y = nextY;
          }

          p.age += 1;
          if (
            p.age >= p.maxAge ||
            p.x < 0 ||
            p.x > width ||
            p.y < 0 ||
            p.y > height
          ) {
            p.x = Math.random() * width;
            p.y = Math.random() * height;
            p.age = 0;
          }
        }
        ctx.restore();
      }

      rafId = window.requestAnimationFrame(renderLoop);
    };

    if (canAnimate) {
      rafId = window.requestAnimationFrame(renderLoop);
    }

    const handleMapTransform = () => {
      drawStaticField();
    };

    if (typeof map.on === 'function') {
      map.on('moveend zoomend resize', handleMapTransform);
    }

    return () => {
      isDisposed = true;
      if (rafId !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId);
      }
      if (typeof map.off === 'function') {
        map.off('moveend zoomend resize', handleMapTransform);
      }
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      canvasRef.current = null;
    };
  }, [animateFlow, layerId, map, modelMode, opacity, points]);

  return null;
};

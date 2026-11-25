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
  hourTimestamp?: number | null;
  opacity?: number;
  animateFlow?: boolean;
  showWindStreamlines?: boolean;
  onLayerError?: (error: Error) => void;
}

interface FlowParticle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  trail: Array<{ x: number; y: number }>;
}

interface CachedFlowVector {
  dxStep: number;
  dyStep: number;
  valid: boolean;
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
 *
 * Performance optimization (Anti-Jank):
 * - Caches the static IDW heatmap + vector arrows bitmap onto an offscreen canvas (`offscreenCanvasRef`)
 *   ONLY when `points`, `hourTimestamp`, `layerId`, `modelMode`, `opacity`, or viewport bounds/size change.
 * - Inside `requestAnimationFrame` (~18-20 fps), copies the cached offscreen bitmap via
 *   `ctx.drawImage(offscreenCanvas, 0, 0)` and advances lightweight particle streamlines using
 *   a pre-computed coarse velocity grid — ZERO pixel-by-pixel heatmap recomputation per frame.
 */
export const WeatherModelOverlayLayer: React.FC<WeatherModelOverlayLayerProps> = ({
  layerId,
  modelMode,
  points,
  hourTimestamp = null,
  opacity = 0.72,
  animateFlow = true,
  showWindStreamlines,
  onLayerError,
}) => {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const onLayerErrorRef = useRef<((error: Error) => void) | undefined>(onLayerError);
  onLayerErrorRef.current = onLayerError;

  const shouldRenderStreamlines =
    showWindStreamlines ?? (layerId === 'wind' || layerId === 'waves');

  useEffect(() => {
    const isVisibleLayer = layerId !== 'none' || shouldRenderStreamlines;
    if (!isVisibleLayer) {
      if (canvasRef.current && canvasRef.current.parentNode) {
        canvasRef.current.parentNode.removeChild(canvasRef.current);
        canvasRef.current = null;
      }
      offscreenCanvasRef.current = null;
      return;
    }

    let container: HTMLElement;
    try {
      container = map.getContainer();
    } catch (err) {
      onLayerErrorRef.current?.(
        err instanceof Error ? err : new Error('Leaflet map container unavailable'),
      );
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'weather-model-canvas';
    canvas.dataset.weatherModel = modelMode;
    canvas.dataset.weatherLayer = layerId;
    canvas.dataset.offscreenCached = 'true';
    canvas.dataset.staticRenderCount = '0';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '220';
    canvas.style.transition = 'opacity 220ms ease-out';
    canvasRef.current = canvas;
    container.appendChild(canvas);

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvasRef.current = offscreenCanvas;

    let ctx: CanvasRenderingContext2D | null = null;
    let offscreenCtx: CanvasRenderingContext2D | null = null;
    const isJsdom =
      typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
    if (!isJsdom) {
      try {
        ctx = canvas.getContext('2d');
        offscreenCtx = offscreenCanvas.getContext('2d');
      } catch (err) {
        ctx = null;
        offscreenCtx = null;
        onLayerErrorRef.current?.(
          err instanceof Error ? err : new Error('Canvas 2D context creation failed'),
        );
      }
    }

    let rafId: number | null = null;
    let isDisposed = false;
    let staticRenderCount = 0;
    let cachedWidth = 0;
    let cachedHeight = 0;
    const cellSize = 26;
    let flowCols = 0;
    let flowRows = 0;
    let flowGrid: CachedFlowVector[] = [];

    const particles: FlowParticle[] = [];
    const initParticles = (width: number, height: number) => {
      particles.length = 0;
      const count = Math.min(110, Math.max(40, Math.round((width * height) / 4800)));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          age: Math.floor(Math.random() * 55),
          maxAge: 42 + Math.floor(Math.random() * 44),
          trail: [],
        });
      }
    };

    const rebuildOffscreenStaticField = (): { width: number; height: number } => {
      try {
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
        if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
          offscreenCanvas.width = width;
          offscreenCanvas.height = height;
        }

        cachedWidth = width;
        cachedHeight = height;
        staticRenderCount += 1;
        canvas.dataset.staticRenderCount = String(staticRenderCount);

        if (!ctx || !offscreenCtx || points.length === 0) {
          if (ctx) {
            ctx.clearRect(0, 0, width, height);
          }
          if (offscreenCtx) {
            offscreenCtx.clearRect(0, 0, width, height);
          }
          return { width, height };
        }

        offscreenCtx.clearRect(0, 0, width, height);
        offscreenCtx.imageSmoothingEnabled = true;

        flowCols = Math.max(1, Math.ceil(width / cellSize));
        flowRows = Math.max(1, Math.ceil(height / cellSize));
        flowGrid = new Array<CachedFlowVector>(flowCols * flowRows);

        // 1. Interpolated meteorological heat cells rendered ONLY to offscreenCanvas
        for (let row = 0; row < flowRows; row++) {
          const y = row * cellSize;
          for (let col = 0; col < flowCols; col++) {
            const x = col * cellSize;
            const cellIdx = row * flowCols + col;
            let latLng: L.LatLng;
            try {
              latLng = map.containerPointToLatLng(
                L.point(x + cellSize / 2, y + cellSize / 2),
              );
            } catch {
              flowGrid[cellIdx] = { dxStep: 0, dyStep: 0, valid: false };
              continue;
            }

            if (layerId !== 'none') {
              const sample = interpolateGridValueAtPoint(
                points,
                latLng.lat,
                latLng.lng,
                layerId,
              );
              const [r, g, b, a] = getWeatherOverlayRgba(layerId, sample.value);
              if (a > 0) {
                const finalAlpha = Math.max(0.03, Math.min(0.68, (a / 255) * opacity));
                offscreenCtx.fillStyle = `rgba(${r}, ${g}, ${b}, ${finalAlpha.toFixed(3)})`;
                offscreenCtx.fillRect(x, y, cellSize + 1, cellSize + 1);
              }
            }

            const vectorSample =
              layerId === 'waves'
                ? interpolateGridValueAtPoint(points, latLng.lat, latLng.lng, 'waves')
                : interpolateGridValueAtPoint(points, latLng.lat, latLng.lng, 'wind');

            if (vectorSample.windDirectionDeg !== null) {
              const speed = vectorSample.value ?? 10;
              const blowToRad = (((vectorSample.windDirectionDeg + 180) % 360) * Math.PI) / 180;
              const stepPx = Math.max(1.3, Math.min(5.2, 1.0 + speed * 0.085));
              flowGrid[cellIdx] = {
                dxStep: Math.sin(blowToRad) * stepPx,
                dyStep: -Math.cos(blowToRad) * stepPx,
                valid: true,
              };
            } else {
              flowGrid[cellIdx] = { dxStep: 0, dyStep: 0, valid: false };
            }
          }
        }

        // 2. Vector arrows (for wind / waves) or grid numerical badges (for temp / rain) on offscreenCanvas
        if (layerId !== 'none') {
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
                    offscreenCtx,
                    x,
                    y,
                    sample.windDirectionDeg,
                    layerId === 'waves' ? speed * 8 : speed,
                    'rgba(15, 23, 42, 0.54)',
                  );
                }
              } else if (sample.value !== null) {
                const text =
                  layerId === 'temperature'
                    ? `${Math.round(sample.value)}°`
                    : `${sample.value.toFixed(1)}`;
                offscreenCtx.save();
                offscreenCtx.font = '700 10px system-ui, -apple-system, sans-serif';
                offscreenCtx.textAlign = 'center';
                offscreenCtx.textBaseline = 'middle';
                offscreenCtx.fillStyle = 'rgba(255,255,255,0.85)';
                offscreenCtx.fillRect(x - 15, y - 8, 30, 16);
                offscreenCtx.fillStyle = '#0f172a';
                offscreenCtx.fillText(text, x, y);
                offscreenCtx.restore();
              }
            }
          }
        }

        // Blit cached static field onto the visible canvas immediately
        ctx.clearRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(offscreenCanvas, 0, 0);

        return { width, height };
      } catch (err) {
        onLayerErrorRef.current?.(
          err instanceof Error ? err : new Error('Failed to render weather model overlay'),
        );
        return { width: cachedWidth || 640, height: cachedHeight || 360 };
      }
    };

    const { width: initialW, height: initialH } = rebuildOffscreenStaticField();
    if (particles.length === 0) {
      initParticles(initialW, initialH);
    }

    const canAnimate =
      animateFlow &&
      (shouldRenderStreamlines || layerId === 'wind' || layerId === 'waves') &&
      Boolean(ctx) &&
      Boolean(offscreenCtx) &&
      points.length > 0 &&
      typeof window !== 'undefined' &&
      typeof window.requestAnimationFrame === 'function';

    let lastFrameMs = 0;
    const FRAME_INTERVAL_MS = 45;

    const renderLoop = (nowMs: number) => {
      if (isDisposed || !ctx || !offscreenCanvasRef.current) return;

      const isHidden =
        typeof document !== 'undefined' && Boolean(document.hidden);

      if (!isHidden && points.length > 0 && nowMs - lastFrameMs >= FRAME_INTERVAL_MS) {
        lastFrameMs = nowMs;
        try {
          const width = cachedWidth || canvas.width || 640;
          const height = cachedHeight || canvas.height || 360;

          // Fast bitmap blit from cached offscreenCanvas — ZERO heatmap recomputation per frame
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(offscreenCanvasRef.current, 0, 0);

          if (flowCols > 0 && flowRows > 0 && flowGrid.length > 0) {
            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const streakRgb = layerId === 'waves' ? '224, 242, 254' : '255, 255, 255';

            for (const p of particles) {
              const col = Math.max(0, Math.min(flowCols - 1, Math.floor(p.x / cellSize)));
              const row = Math.max(0, Math.min(flowRows - 1, Math.floor(p.y / cellSize)));
              const vec = flowGrid[row * flowCols + col];

              if (vec && vec.valid) {
                p.trail.push({ x: p.x, y: p.y });
                if (p.trail.length > 5) {
                  p.trail.shift();
                }

                const nextX = p.x + vec.dxStep;
                const nextY = p.y + vec.dyStep;
                const lifeAlpha = Math.sin((p.age / p.maxAge) * Math.PI) * 0.78;

                if (p.trail.length >= 2) {
                  for (let t = 1; t < p.trail.length; t++) {
                    const segFrac = t / p.trail.length;
                    ctx.strokeStyle = `rgba(${streakRgb}, ${(Math.max(0.1, lifeAlpha) * segFrac).toFixed(2)})`;
                    ctx.lineWidth = 1.0 + segFrac * 0.9;
                    ctx.beginPath();
                    ctx.moveTo(p.trail[t - 1]!.x, p.trail[t - 1]!.y);
                    ctx.lineTo(p.trail[t]!.x, p.trail[t]!.y);
                    ctx.stroke();
                  }
                }
                ctx.strokeStyle = `rgba(${streakRgb}, ${Math.max(0.18, lifeAlpha).toFixed(2)})`;
                ctx.lineWidth = 1.9;
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
                p.trail.length = 0;
              }
            }
            ctx.restore();
          }
        } catch (err) {
          onLayerErrorRef.current?.(
            err instanceof Error ? err : new Error('Weather overlay animation frame error'),
          );
          return;
        }
      }

      rafId = window.requestAnimationFrame(renderLoop);
    };

    if (canAnimate) {
      rafId = window.requestAnimationFrame(renderLoop);
    }

    const handleMapTransform = () => {
      rebuildOffscreenStaticField();
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
      offscreenCanvasRef.current = null;
    };
  }, [animateFlow, hourTimestamp, layerId, map, modelMode, opacity, points, shouldRenderStreamlines]);

  return null;
};

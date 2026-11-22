import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export const TARGET_PHOTO_MAX_KB = 200;
export const DEFAULT_MAX_PHOTO_DIMENSION_PX = 1280;

export interface CompressedPhotoResult {
  dataUrl: string;
  mimeType: 'image/webp' | 'image/jpeg';
  sizeKb: number;
  width: number;
  height: number;
}

export interface CompressImageOptions {
  targetMaxKb?: number;
  maxDimensionPx?: number;
  preferredMimeType?: 'image/webp' | 'image/jpeg';
  initialQuality?: number;
}

export interface CapturePhotoOptions extends CompressImageOptions {
  source?: 'camera' | 'gallery' | 'prompt';
  isNativePlatformFn?: () => boolean;
}

/**
 * Calcula o tamanho aproximado em Kilobytes (KB) de uma Data URL base64.
 */
export function estimateDataUrlSizeKb(dataUrl: string): number {
  if (!dataUrl) return 0;
  const commaIndex = dataUrl.indexOf(',');
  const base64Part = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64Part.endsWith('==') ? 2 : base64Part.endsWith('=') ? 1 : 0;
  const byteLength = Math.max(0, (base64Part.length * 3) / 4 - padding);
  return Number((byteLength / 1024).toFixed(2));
}

/**
 * Calcula dimensões proporcionais respeitando o limite máximo de aresta (`maxDimensionPx`).
 */
export function computeScaledDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDimensionPx = DEFAULT_MAX_PHOTO_DIMENSION_PX,
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(srcWidth));
  const safeH = Math.max(1, Math.round(srcHeight));
  const maxSide = Math.max(safeW, safeH);

  if (maxSide <= maxDimensionPx) {
    return { width: safeW, height: safeH };
  }

  const scale = maxDimensionPx / maxSide;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

/**
 * Lê um objeto `File` ou `Blob` e converte para Data URL (`data:image/...;base64,...`).
 */
export function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Falha ao converter arquivo de imagem para Data URL.'));
      }
    };
    reader.onerror = () => {
      reject(new Error('Erro de leitura do arquivo de imagem selecionado.'));
    };
    reader.readAsDataURL(file);
  });
}

function isJsdomEnvironment(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
}

function loadHtmlImage(dataUrl: string, timeoutMs = 1500): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || isJsdomEnvironment()) {
      reject(new Error('Decoder gráfico nativo indisponível neste ambiente.'));
      return;
    }
    const img = new Image();
    const timer = setTimeout(() => {
      reject(new Error('Timeout ao decodificar imagem no navegador.'));
    }, timeoutMs);

    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Não foi possível decodificar a imagem selecionada.'));
    };
    img.src = dataUrl;
  });
}

/**
 * Comprime uma imagem em Data URL via `<canvas>` visando tamanho `<= 200 KB` (WebP ou JPEG).
 */
export async function compressImageDataUrl(
  sourceDataUrl: string,
  options?: CompressImageOptions,
): Promise<CompressedPhotoResult> {
  const targetMaxKb = options?.targetMaxKb ?? TARGET_PHOTO_MAX_KB;
  const maxDimensionPx = options?.maxDimensionPx ?? DEFAULT_MAX_PHOTO_DIMENSION_PX;
  const preferredMime = options?.preferredMimeType ?? 'image/webp';
  const initialQuality = options?.initialQuality ?? 0.82;

  if (typeof document === 'undefined') {
    const fallbackMime: 'image/webp' | 'image/jpeg' = sourceDataUrl.startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';
    return {
      dataUrl: sourceDataUrl,
      mimeType: fallbackMime,
      sizeKb: estimateDataUrlSizeKb(sourceDataUrl),
      width: maxDimensionPx,
      height: maxDimensionPx,
    };
  }

  let img: HTMLImageElement;
  try {
    img = await loadHtmlImage(sourceDataUrl);
  } catch {
    // Fallback resiliente para ambientes sem decoder gráfico (ex.: jsdom)
    const fallbackMime: 'image/webp' | 'image/jpeg' = sourceDataUrl.startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';
    return {
      dataUrl: sourceDataUrl,
      mimeType: fallbackMime,
      sizeKb: estimateDataUrlSizeKb(sourceDataUrl),
      width: maxDimensionPx,
      height: maxDimensionPx,
    };
  }

  let { width, height } = computeScaledDimensions(
    img.naturalWidth || img.width || maxDimensionPx,
    img.naturalHeight || img.height || maxDimensionPx,
    maxDimensionPx,
  );

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    const fallbackMime: 'image/webp' | 'image/jpeg' = sourceDataUrl.startsWith('data:image/webp')
      ? 'image/webp'
      : 'image/jpeg';
    return {
      dataUrl: sourceDataUrl,
      mimeType: fallbackMime,
      sizeKb: estimateDataUrlSizeKb(sourceDataUrl),
      width,
      height,
    };
  }

  const qualitySteps = [initialQuality, 0.72, 0.6, 0.48, 0.36, 0.26];
  let bestDataUrl = sourceDataUrl;
  let bestMime: 'image/webp' | 'image/jpeg' = preferredMime;
  let bestSizeKb = estimateDataUrlSizeKb(sourceDataUrl);

  for (let scalePass = 0; scalePass < 2; scalePass++) {
    if (scalePass > 0) {
      width = Math.max(320, Math.round(width * 0.75));
      height = Math.max(240, Math.round(height * 0.75));
    }

    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    for (const quality of qualitySteps) {
      let candidate = canvas.toDataURL(preferredMime, quality);
      let usedMime: 'image/webp' | 'image/jpeg' = preferredMime;

      // Se o navegador não suportar image/webp no toDataURL, ele retorna data:image/png
      if (!candidate.startsWith(`data:${preferredMime}`)) {
        usedMime = 'image/jpeg';
        candidate = canvas.toDataURL('image/jpeg', quality);
      }

      const candidateKb = estimateDataUrlSizeKb(candidate);
      bestDataUrl = candidate;
      bestMime = usedMime;
      bestSizeKb = candidateKb;

      if (candidateKb <= targetMaxKb) {
        return {
          dataUrl: bestDataUrl,
          mimeType: bestMime,
          sizeKb: bestSizeKb,
          width,
          height,
        };
      }
    }
  }

  return {
    dataUrl: bestDataUrl,
    mimeType: bestMime,
    sizeKb: bestSizeKb,
    width,
    height,
  };
}

/**
 * Comprime um `File` de imagem do `<input type="file" accept="image/*" capture="environment">`
 * para `~200 KB` via `<canvas>`.
 */
export async function compressImageFile(
  file: File,
  options?: CompressImageOptions,
): Promise<CompressedPhotoResult> {
  const rawDataUrl = await readFileAsDataUrl(file);
  return compressImageDataUrl(rawDataUrl, options);
}

/**
 * Abre seletor de arquivo `<input type="file" accept="image/*" capture="environment">` na Web
 * e retorna o arquivo comprimido.
 */
export function pickAndCompressImageFromWebInput(
  options?: CompressImageOptions & { captureEnvironment?: boolean },
): Promise<CompressedPhotoResult> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Ambiente DOM indisponível para seleção de imagem.'));
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (options?.captureEnvironment !== false) {
      input.setAttribute('capture', 'environment');
    }

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('Nenhuma foto selecionada.'));
        return;
      }
      try {
        const compressed = await compressImageFile(file, options);
        resolve(compressed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Erro ao comprimir foto selecionada.'));
      }
    };

    input.click();
  });
}

/**
 * Captura foto utilizando `@capacitor/camera` no Android/iOS nativo ou `<input type="file" capture="environment">`
 * na Web, aplicando compressão automática via `<canvas>` para ~200 KB.
 */
export async function captureAndCompressPhoto(
  options?: CapturePhotoOptions,
): Promise<CompressedPhotoResult> {
  const isNative =
    options?.isNativePlatformFn?.() ??
    (() => {
      try {
        return Capacitor.isNativePlatform();
      } catch {
        return false;
      }
    })();

  if (isNative) {
    const capSource =
      options?.source === 'gallery'
        ? CameraSource.Photos
        : options?.source === 'prompt'
          ? CameraSource.Prompt
          : CameraSource.Camera;

    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: capSource,
      width: options?.maxDimensionPx ?? DEFAULT_MAX_PHOTO_DIMENSION_PX,
      height: options?.maxDimensionPx ?? DEFAULT_MAX_PHOTO_DIMENSION_PX,
      correctOrientation: true,
    });

    if (!photo.dataUrl) {
      throw new Error('A câmera nativa não retornou uma imagem válida.');
    }

    return compressImageDataUrl(photo.dataUrl, options);
  }

  return pickAndCompressImageFromWebInput({
    ...options,
    captureEnvironment: options?.source !== 'gallery',
  });
}

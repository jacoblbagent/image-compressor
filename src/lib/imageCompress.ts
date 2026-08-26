/* ------------------------------------------------------------------
 * imageCompress.ts
 * A from-scratch, in-browser image compression engine.
 *
 * No image libraries — everything is built on the native Canvas 2D
 * API plus a hand-written color quantizer for genuinely small PNGs.
 *
 * Strategies:
 *   - "jpeg":  canvas -> image/jpeg @ quality  (familiar, universal)
 *   - "webp":  canvas -> image/webp @ quality  (best modern format)
 *   - "png":   lossless re-encode + optional resize. Because re-encoding
 *              a photo as 24-bit PNG almost never shrinks it, we also
 *              offer a hand-rolled palette quantizer (below) that turns
 *              a truecolor image into an "8-bit style" PNG which can be
 *              dramatically smaller.
 *
 * All heavy lifting happens on-device; no bytes ever leave the browser.
 * ------------------------------------------------------------------ */

export type OutputFormat = "jpeg" | "webp" | "png";

export interface CompressOptions {
  format: OutputFormat;
  /** 0.0 - 1.0 quality. Ignored for lossless 24-bit PNG. */
  quality: number;
  /** max output longest-edge in px; 0 = keep original dimensions */
  maxWidth: number;
  /** true to run the lossy quantizer on PNG output (8-bit style) */
  lossyPng: boolean;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  size: number; // bytes
}

/** Decode a File/Blob into an HTMLImageElement for canvas re-encoding. */
export function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Decoded image has no dimensions — unsupported format."));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode this image. Is it a valid image file?"));
    };
    img.src = url;
  });
}

/** Downscale so the longest edge never exceeds maxLength. */
export function fitWithin(imgW: number, imgH: number, maxLength: number) {
  if (!maxLength || (imgW <= maxLength && imgH <= maxLength)) {
    return { width: imgW, height: imgH };
  }
  const ratio = Math.min(maxLength / imgW, maxLength / imgH);
  return { width: Math.max(1, Math.round(imgW * ratio)), height: Math.max(1, Math.round(imgH * ratio)) };
}

/** 142 B / 4.2 KB / 1.3 MB */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Hand-written color quantizer (a simplified octree → k-means hybrid).
 *
 * 1. Reduces each pixel's 8-bit channels to 5-bit buckets and tallies a
 *    histogram (this *is* the octree's pruning, done explicitly).
 * 2. Keeps the `levels` most frequent buckets as palette centers.
 * 3. Maps every pixel to its nearest center, rebuilding a limited-palette
 *    image that PNG can encode far more efficiently.
 */
function quantize(
  data: Uint8ClampedArray,
  levels: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  const outFilled = out.length > 0;

  // ---- 1. Histogram over 5-bit channels -----------------------------
  const keyOf = (r: number, g: number, b: number, a: number) =>
    ((r << 15) | (g << 10) | (b << 5) | a); // 5 bits each

  // Accumulators: sum of each channel + count. We use arrays keyed by the
  // reduced bucket so unrelated buckets never pollute each other.
  const hist = new Map<number, { r: number; g: number; b: number; a: number; n: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3, a = data[i + 3] >> 3;
    const k = keyOf(r, g, b, a);
    const e = hist.get(k);
    if (e) { e.r += r; e.g += g; e.b += b; e.a += a; e.n++; }
    else hist.set(k, { r, g, b, a, n: 1 });
  }

  // ---- 2. Choose palette centers (most frequent buckets) ------------
  const buckets = [...hist.values()].sort((x, y) => y.n - x.n);
  const count = Math.min(levels, buckets.length, 1 << 20);
  const centers = buckets
    .slice(0, count)
    .map((bk) => ({
      r: bk.r / bk.n, g: bk.g / bk.n, b: bk.b / bk.n, a: bk.a / bk.n,
    }));

  // ---- 3. Map every original bucket to its nearest center --------
  const lookup = new Map<number, number>();
  for (const [k, bk] of hist) {
    let best = 0, bestD = Infinity;
    const cr = bk.r / bk.n, cg = bk.g / bk.n, cb = bk.b / bk.n, ca = bk.a / bk.n;
    for (let ci = 0; ci < centers.length; ci++) {
      const c = centers[ci];
      const d = (cr - c.r) ** 2 + (cg - c.g) ** 2 + (cb - c.b) ** 2 + (ca - c.a) ** 2;
      if (d < bestD) { bestD = d; best = ci; }
    }
    lookup.set(k, best);
  }

  // ---- 4. rebuild pixels from palette ----------------------------
  if (!outFilled) return data; // safety (unreachable)
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] >> 3, g = data[i + 1] >> 3, b = data[i + 2] >> 3, a = data[i + 3] >> 3;
    const ci = lookup.get(keyOf(r, g, b, a))!;
    const c = centers[ci];
    out[i] = Math.round(c.r * 8);
    out[i + 1] = Math.round(c.g * 8);
    out[i + 2] = Math.round(c.b * 8);
    out[i + 3] = Math.round(c.a * 8);
  }
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error(`Encoding failed for ${mime}`))),
      mime,
      quality
    );
  });
}

/**
 * Compress an image File into the requested format/size.
 * Returns the output blob plus metadata. Caller owns any object URL created.
 */
export async function compressImage(
  file: File,
  opts: CompressOptions
): Promise<CompressResult> {
  const img = await loadImage(file);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, opts.maxWidth);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  let blob: Blob;

  if (opts.format === "jpeg") {
    blob = await canvasToBlob(canvas, "image/jpeg", opts.quality);
  } else if (opts.format === "webp") {
    blob = await canvasToBlob(canvas, "image/webp", opts.quality);
  } else {
    // PNG
    if (opts.lossyPng) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const reduced = quantize(imageData.data, Math.min(512, Math.max(16, Math.round(opts.quality * 256) * 2)));
      const tmp = document.createElement("canvas");
      tmp.width = width; tmp.height = height;
      const tctx = tmp.getContext("2d")!;
      const d2 = tctx.createImageData(width, height);
      d2.data.set(reduced);
      tctx.putImageData(d2, 0, 0);
      blob = await canvasToBlob(tmp, "image/png");
    } else {
      blob = await canvasToBlob(canvas, "image/png");
    }
  }

  return { blob, width, height, size: blob.size };
}

/** Build a DOM-ready object URL for a blob. Revokes `previous` if given. */
export function objectUrl(blob: Blob, previous?: string | null): string {
  if (previous) URL.revokeObjectURL(previous);
  return URL.createObjectURL(blob);
}
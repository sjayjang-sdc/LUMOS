// Pure-JS image processing helpers used by the Digitizer.
// Operate on Uint8ClampedArray (grayscale W*H) and Uint8ClampedArray (RGBA W*H*4).
"use strict";

// ---------- Conversion ----------

// HTMLImageElement / HTMLCanvasElement → { rgba, gray, width, height }.
function imageToArrays(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const idata = ctx.getImageData(0, 0, c.width, c.height);
  const rgba = idata.data;
  const n = c.width * c.height;
  const gray = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    // Standard luminance.
    gray[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  return { rgba, gray, width: c.width, height: c.height };
}

// File → Promise<{ rgba, gray, width, height, dataUrl }>.
function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const arrs = imageToArrays(img);
        resolve({ ...arrs, dataUrl: reader.result });
      };
      img.onerror = (e) => reject(new Error("Image decode failed"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

// ClipboardItem → Promise of same shape (for paste).
async function readImageFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith("image/")) {
          const blob = await item.getType(type);
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const img = new Image();
              img.onload = () => {
                const arrs = imageToArrays(img);
                resolve({ ...arrs, dataUrl: reader.result });
              };
              img.onerror = (e) => reject(e);
              img.src = reader.result;
            };
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(blob);
          });
        }
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Make an ImageData from a grayscale Uint8 array for drawing.
function grayToImageData(gray, width, height) {
  const id = new ImageData(width, height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    id.data[j] = id.data[j + 1] = id.data[j + 2] = gray[i];
    id.data[j + 3] = 255;
  }
  return id;
}

// ---------- Levels ----------

function adjustLevels(gray, blackPoint, whitePoint, gamma) {
  if (blackPoint === 0 && whitePoint === 255 && Math.abs(gamma - 1.0) < 1e-9) {
    return new Uint8ClampedArray(gray);
  }
  const out = new Uint8ClampedArray(gray.length);
  const range = Math.max(1, whitePoint - blackPoint);
  const invG = 1.0 / Math.max(0.01, gamma);
  for (let i = 0; i < gray.length; i++) {
    let v = (gray[i] - blackPoint) / range;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    if (Math.abs(invG - 1) > 1e-9) v = Math.pow(v, invG);
    out[i] = Math.round(v * 255);
  }
  return out;
}

// ---------- Otsu ----------

function otsuThreshold(gray) {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0;
  let maxVar = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > maxVar) { maxVar = v; threshold = t; }
  }
  return threshold;
}

// ---------- Grid removal ----------

// Detect long horizontal/vertical runs of dark pixels (below threshold)
// inside the optional bbox, then paint them to the background color
// (255 by default). Mirrors what cv.morphologyEx + findContours achieves
// in the Python version, but written directly in JS.
function removeGridLines(gray, width, height, opts = {}) {
  const out = new Uint8ClampedArray(gray);
  const threshold = opts.threshold != null
    ? opts.threshold
    : otsuThreshold(gray);
  const lineLength = opts.lineLength || 20;
  const thickness = opts.thickness || 2;
  const bg = opts.bg ?? 255;
  const bbox = opts.bbox || [0, 0, width, height];
  const [bx0, by0, bx1, by1] = bbox;
  const inset = opts.inset || 0;
  const x0 = Math.max(0, bx0 + inset);
  const y0 = Math.max(0, by0 + inset);
  const x1 = Math.min(width, bx1 - inset);
  const y1 = Math.min(height, by1 - inset);

  // Horizontal runs.
  for (let y = y0; y < y1; y++) {
    let runStart = -1;
    for (let x = x0; x <= x1; x++) {
      const v = (x < x1) ? gray[y * width + x] : 999;
      if (v < threshold) {
        if (runStart < 0) runStart = x;
      } else {
        if (runStart >= 0 && (x - runStart) >= lineLength) {
          paintBlock(out, width, height, runStart, y, x, y + 1, thickness, bg);
        }
        runStart = -1;
      }
    }
  }
  // Vertical runs.
  for (let x = x0; x < x1; x++) {
    let runStart = -1;
    for (let y = y0; y <= y1; y++) {
      const v = (y < y1) ? gray[y * width + x] : 999;
      if (v < threshold) {
        if (runStart < 0) runStart = y;
      } else {
        if (runStart >= 0 && (y - runStart) >= lineLength) {
          paintBlock(out, width, height, x, runStart, x + 1, y, thickness, bg);
        }
        runStart = -1;
      }
    }
  }
  return out;
}

function paintBlock(gray, width, height, x0, y0, x1, y1, thickness, bg) {
  const t = Math.max(0, thickness - 1);
  const xs = Math.max(0, x0 - t);
  const ys = Math.max(0, y0 - t);
  const xe = Math.min(width, x1 + t);
  const ye = Math.min(height, y1 + t);
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      gray[y * width + x] = bg;
    }
  }
}

// Compute a binary mask of pixels that grid removal WOULD paint over
// (for the "Grid detection" preview overlay).
function gridMask(gray, width, height, opts = {}) {
  const threshold = opts.threshold != null ? opts.threshold : otsuThreshold(gray);
  const lineLength = opts.lineLength || 20;
  const bbox = opts.bbox || [0, 0, width, height];
  const [bx0, by0, bx1, by1] = bbox;
  const inset = opts.inset || 0;
  const x0 = Math.max(0, bx0 + inset);
  const y0 = Math.max(0, by0 + inset);
  const x1 = Math.min(width, bx1 - inset);
  const y1 = Math.min(height, by1 - inset);
  const thickness = opts.thickness || 2;
  const t = Math.max(0, thickness - 1);

  const mask = new Uint8Array(width * height);
  // Horizontal
  for (let y = y0; y < y1; y++) {
    let runStart = -1;
    for (let x = x0; x <= x1; x++) {
      const v = (x < x1) ? gray[y * width + x] : 999;
      if (v < threshold) {
        if (runStart < 0) runStart = x;
      } else {
        if (runStart >= 0 && (x - runStart) >= lineLength) {
          for (let yy = Math.max(0, y - t); yy < Math.min(height, y + 1 + t); yy++) {
            for (let xx = runStart; xx < x; xx++) mask[yy * width + xx] = 1;
          }
        }
        runStart = -1;
      }
    }
  }
  // Vertical
  for (let x = x0; x < x1; x++) {
    let runStart = -1;
    for (let y = y0; y <= y1; y++) {
      const v = (y < y1) ? gray[y * width + x] : 999;
      if (v < threshold) {
        if (runStart < 0) runStart = y;
      } else {
        if (runStart >= 0 && (y - runStart) >= lineLength) {
          for (let xx = Math.max(0, x - t); xx < Math.min(width, x + 1 + t); xx++) {
            for (let yy = runStart; yy < y; yy++) mask[yy * width + xx] = 1;
          }
        }
        runStart = -1;
      }
    }
  }
  return mask;
}

// ---------- Foreground / background stats ----------

// Histogram-based dominant gray detection. Returns { bgcolor, trajcolors[] }.
// Mirrors LUMOS_digitizer_core._compute_foreground_background_stats.
function fgbgStats(gray) {
  const NBINS = 25;
  let hi = 0;
  for (const v of gray) if (v > hi) hi = v;
  hi = Math.max(1, hi);
  const binWidth = hi / NBINS;
  const hist = new Float64Array(NBINS);
  for (const v of gray) {
    const idx = Math.min(NBINS - 1, Math.floor(v / binWidth));
    hist[idx]++;
  }
  const minCount = Math.max(5, Math.floor(gray.length / (NBINS * 50)));
  const surviving = [];
  for (let i = 0; i < NBINS; i++) {
    if (hist[i] >= minCount) surviving.push(i);
  }
  if (surviving.length === 0) {
    throw new Error("No dominant gray level — image too sparse?");
  }
  // Per-value counts for mode lookup
  const counts = new Float64Array(256);
  for (const v of gray) counts[v]++;
  function modeInBin(idx) {
    const lo = Math.max(0, Math.ceil(idx * binWidth));
    const up = Math.min(256, Math.ceil((idx + 1) * binWidth));
    let bestIdx = lo, bestCount = -1;
    for (let v = lo; v < up; v++) {
      if (counts[v] > bestCount) { bestCount = counts[v]; bestIdx = v; }
    }
    return bestIdx;
  }
  surviving.sort((a, b) => hist[b] - hist[a]);
  const bg = modeInBin(surviving[0]);
  if (bg < 128) {
    throw new Error("Background appears dark — try Auto-invert.");
  }
  const trajcolors = [];
  for (const idx of surviving) {
    const c = modeInBin(idx);
    if (c / bg >= 0.5) continue;
    trajcolors.push(c);
  }
  return { bgcolor: bg, trajcolors };
}

// ---------- Color distance mask ----------

// Returns a Uint8 mask (1 if within tolerance) for an RGB image.
function colorDistanceMask(rgba, width, height, target, tolerance) {
  const mask = new Uint8Array(width * height);
  const tol2 = tolerance * tolerance;
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const dr = rgba[j]     - target[0];
    const dg = rgba[j + 1] - target[1];
    const db = rgba[j + 2] - target[2];
    if (dr * dr + dg * dg + db * db <= tol2) mask[i] = 1;
  }
  return mask;
}

// ---------- Connected components (8-connectivity, BFS-based) ----------

// Returns { labels: Int32Array, count, sizes: Int32Array, centroids: Float64Array[2] }
function connectedComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  const sizes = [0];  // label 0 = background
  const cxs = [0], cys = [0];
  const queue = new Int32Array(width * height);
  let cur = 1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    labels[i] = cur;
    let count = 0;
    let sumX = 0, sumY = 0;
    while (head < tail) {
      const k = queue[head++];
      const x = k % width;
      const y = (k - x) / width;
      sumX += x;
      sumY += y;
      count += 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nk = ny * width + nx;
          if (!mask[nk] || labels[nk]) continue;
          labels[nk] = cur;
          queue[tail++] = nk;
        }
      }
    }
    sizes.push(count);
    cxs.push(sumX / count);
    cys.push(sumY / count);
    cur += 1;
  }
  return {
    labels,
    count: cur - 1,  // excluding background (0)
    sizes: Int32Array.from(sizes),
    centroids: cxs.map((cx, i) => [cx, cys[i]]),
  };
}

// Keep only the largest connected blob.
function keepLargest(mask, width, height) {
  const cc = connectedComponents(mask, width, height);
  if (cc.count === 0) return new Uint8Array(mask);
  let bestIdx = 0, bestSize = 0;
  for (let i = 1; i <= cc.count; i++) {
    if (cc.sizes[i] > bestSize) { bestSize = cc.sizes[i]; bestIdx = i; }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (cc.labels[i] === bestIdx) out[i] = 1;
  }
  return out;
}

// Chamfer (3-4) distance transform of a binary mask (1 = foreground). Each
// foreground pixel gets its approximate distance to the nearest background
// pixel; the centre of a filled symbol is the local maximum.
function distanceTransform(mask, w, h) {
  const INF = 1e9;
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + a);
      if (y > 0) m = Math.min(m, d[i - w] + a);
      if (x > 0 && y > 0) m = Math.min(m, d[i - w - 1] + b);
      if (x < w - 1 && y > 0) m = Math.min(m, d[i - w + 1] + b);
      d[i] = m;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + a);
      if (y < h - 1) m = Math.min(m, d[i + w] + a);
      if (x < w - 1 && y < h - 1) m = Math.min(m, d[i + w + 1] + b);
      if (x > 0 && y < h - 1) m = Math.min(m, d[i + w - 1] + b);
      d[i] = m;
    }
  }
  return d;
}

// ---------- Extract trajectory ----------

// Given band_mask (1 = candidate pixel), ROI bbox, and the transform
// coefficients, return list of (data_x, data_y) tuples.
// outputMode: 'line' (one y per x column, upper-half median) or
// 'symbols' (one (x, y) per blob centroid, min area filter).
function extractFromMask(mask, width, height, opts = {}) {
  const bbox = opts.bbox || [0, 0, width, height];
  const [bx0, by0, bx1, by1] = bbox;
  const transform = opts.transform;  // { sX, offX, sY, offY, logX, logY }
  const outputMode = opts.outputMode || "line";
  const minSymbolArea = opts.minSymbolArea || 5;

  const pxToData = (px, py) => {
    const rawX = (px - transform.offX) / transform.sX;
    const rawY = (py - transform.offY) / transform.sY;
    const dx = transform.logX ? Math.pow(10, rawX) : rawX;
    const dy = transform.logY ? Math.pow(10, rawY) : rawY;
    return [dx, dy];
  };

  if (outputMode === "symbols") {
    // Connected components in ROI subarray (operate on ROI copy).
    const roiW = bx1 - bx0;
    const roiH = by1 - by0;
    const roiMask = new Uint8Array(roiW * roiH);
    for (let y = 0; y < roiH; y++) {
      for (let x = 0; x < roiW; x++) {
        roiMask[y * roiW + x] = mask[(y + by0) * width + (x + bx0)];
      }
    }
    const cc = connectedComponents(roiMask, roiW, roiH);

    if (!opts.splitTouching) {
      // One centroid per blob (touching filled symbols merge into one point).
      const res = [];
      for (let i = 1; i <= cc.count; i++) {
        if (cc.sizes[i] < minSymbolArea) continue;
        const [cx, cy] = cc.centroids[i];
        res.push(pxToData(cx + bx0, cy + by0));
      }
      return res.sort((a, b) => a[0] - b[0]);
    }

    // Split touching/overlapping filled symbols: each symbol centre is a local
    // maximum of the distance transform (farthest-from-edge point). Pick those
    // maxima with non-maximum suppression so overlapping blobs yield one point
    // each instead of a single merged centroid.
    const minSep = Math.max(2, opts.minSep || 8);
    const dt = distanceTransform(roiMask, roiW, roiH);
    const r = Math.max(1, Math.floor(minSep / 2));
    const cands = [];
    for (let y = 0; y < roiH; y++) {
      for (let x = 0; x < roiW; x++) {
        const i = y * roiW + x;
        const v = dt[i];
        if (v <= 0) continue;
        if (cc.sizes[cc.labels[i]] < minSymbolArea) continue;
        let isMax = true;
        for (let dy = -r; dy <= r && isMax; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= roiH) continue;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= roiW) continue;
            if (dt[ny * roiW + nx] > v) { isMax = false; break; }
          }
        }
        if (isMax) cands.push(i);
      }
    }
    cands.sort((p, q) => dt[q] - dt[p]);
    const minSep2 = minSep * minSep;
    const peaks = [];
    for (const idx of cands) {
      const x = idx % roiW, y = (idx - x) / roiW;
      let ok = true;
      for (const p of peaks) { const dx = p.x - x, dy = p.y - y; if (dx * dx + dy * dy < minSep2) { ok = false; break; } }
      if (ok) peaks.push({ x, y });
    }
    return peaks.map((p) => pxToData(p.x + bx0, p.y + by0)).sort((a, b) => a[0] - b[0]);
  }

  // Line mode: per-X column, upper-half-median y. ROI-local.
  // xStep thins the output to ~one point per `xStep` pixel columns (1 = densest).
  const xStep = Math.max(1, Math.round(opts.xStep || 1));
  const byX = new Map();
  for (let y = by0; y < by1; y++) {
    for (let x = bx0; x < bx1; x++) {
      if (!mask[y * width + x]) continue;
      if (!byX.has(x)) byX.set(x, []);
      byX.get(x).push(y);
    }
  }
  const res = [];
  const sortedX = Array.from(byX.keys()).sort((a, b) => a - b);
  let lastX = -Infinity;
  for (const x of sortedX) {
    if (x - lastX < xStep) continue;
    const ys = byX.get(x);
    ys.sort((a, b) => a - b);
    // Median, then median of upper half (>= median).
    const mid = ys[Math.floor(ys.length / 2)];
    const upper = ys.filter((v) => v >= mid);
    if (upper.length === 0) continue;
    const ym = upper[Math.floor(upper.length / 2)];
    res.push(pxToData(x, ym));
    lastX = x;
  }
  return res;
}

// ---------- Helpers exported ----------
window.LUMOS_imageproc = {
  imageToArrays, readImageFile, readImageFromClipboard,
  grayToImageData,
  adjustLevels,
  otsuThreshold,
  removeGridLines, gridMask,
  fgbgStats,
  colorDistanceMask,
  connectedComponents, keepLargest,
  distanceTransform,
  extractFromMask,
};

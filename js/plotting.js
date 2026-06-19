// Canvas-based plot primitives. No external library.
// Provides: colormaps, heatmap rendering, contour lines via marching
// squares, scatter / line / box drawing, axis ticks + labels.
"use strict";

// ---------- Colormaps ----------
// Small set of perceptually-OK gradients sampled at 256 stops.

const CMAPS = (() => {
  function makeCmap(stops) {
    const lut = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let prev = stops[0];
      let next = stops[stops.length - 1];
      for (let j = 0; j < stops.length - 1; j++) {
        if (t >= stops[j].t && t <= stops[j + 1].t) {
          prev = stops[j];
          next = stops[j + 1];
          break;
        }
      }
      const u = (next.t === prev.t) ? 0 : (t - prev.t) / (next.t - prev.t);
      lut[3 * i + 0] = Math.round(prev.r + (next.r - prev.r) * u);
      lut[3 * i + 1] = Math.round(prev.g + (next.g - prev.g) * u);
      lut[3 * i + 2] = Math.round(prev.b + (next.b - prev.b) * u);
    }
    return lut;
  }

  // Approximate viridis (5 anchor stops sampled from the real LUT).
  const viridis = makeCmap([
    { t: 0.00, r: 68,  g: 1,   b: 84 },
    { t: 0.25, r: 65,  g: 68,  b: 135 },
    { t: 0.50, r: 42,  g: 120, b: 142 },
    { t: 0.75, r: 34,  g: 168, b: 132 },
    { t: 1.00, r: 253, g: 231, b: 36 },
  ]);
  const plasma = makeCmap([
    { t: 0.00, r: 13,  g: 8,   b: 135 },
    { t: 0.25, r: 126, g: 3,   b: 167 },
    { t: 0.50, r: 203, g: 70,  b: 121 },
    { t: 0.75, r: 248, g: 148, b: 65 },
    { t: 1.00, r: 240, g: 249, b: 33 },
  ]);
  const inferno = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 4 },
    { t: 0.25, r: 87,  g: 16,  b: 110 },
    { t: 0.50, r: 188, g: 55,  b: 84 },
    { t: 0.75, r: 249, g: 142, b: 9 },
    { t: 1.00, r: 252, g: 255, b: 164 },
  ]);
  const magma = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 4 },
    { t: 0.25, r: 80,  g: 18,  b: 123 },
    { t: 0.50, r: 183, g: 55,  b: 121 },
    { t: 0.75, r: 251, g: 137, b: 97 },
    { t: 1.00, r: 252, g: 253, b: 191 },
  ]);
  const turbo = makeCmap([
    { t: 0.00, r: 48,  g: 18,  b: 59 },
    { t: 0.20, r: 70,  g: 117, b: 237 },
    { t: 0.40, r: 39,  g: 215, b: 187 },
    { t: 0.60, r: 168, g: 240, b: 79 },
    { t: 0.80, r: 247, g: 152, b: 35 },
    { t: 1.00, r: 122, g: 4,   b: 3 },
  ]);
  const jet = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 128 },
    { t: 0.25, r: 0,   g: 128, b: 255 },
    { t: 0.50, r: 0,   g: 255, b: 0 },
    { t: 0.75, r: 255, g: 200, b: 0 },
    { t: 1.00, r: 128, g: 0,   b: 0 },
  ]);
  const gray = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 0 },
    { t: 1.00, r: 255, g: 255, b: 255 },
  ]);
  const coolwarm = makeCmap([
    { t: 0.00, r: 59,  g: 76,  b: 192 },
    { t: 0.50, r: 221, g: 221, b: 221 },
    { t: 1.00, r: 180, g: 4,   b: 38 },
  ]);
  const cividis = makeCmap([
    { t: 0.00, r: 0,   g: 32,  b: 76 },
    { t: 0.50, r: 124, g: 123, b: 120 },
    { t: 1.00, r: 255, g: 233, b: 69 },
  ]);
  const seismic = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 76 },
    { t: 0.25, r: 0,   g: 0,   b: 255 },
    { t: 0.50, r: 255, g: 255, b: 255 },
    { t: 0.75, r: 255, g: 0,   b: 0 },
    { t: 1.00, r: 128, g: 0,   b: 0 },
  ]);
  const hot = makeCmap([
    { t: 0.00, r: 0,   g: 0,   b: 0 },
    { t: 0.40, r: 230, g: 0,   b: 0 },
    { t: 0.75, r: 255, g: 210, b: 0 },
    { t: 1.00, r: 255, g: 255, b: 255 },
  ]);
  const RdYlBu_r = makeCmap([
    { t: 0.00, r: 49,  g: 54,  b: 149 },
    { t: 0.25, r: 116, g: 173, b: 209 },
    { t: 0.50, r: 255, g: 255, b: 191 },
    { t: 0.75, r: 253, g: 174, b: 97 },
    { t: 1.00, r: 165, g: 0,   b: 38 },
  ]);

  return { viridis, plasma, inferno, magma, turbo, jet, gray, coolwarm, cividis, seismic, hot, RdYlBu_r };
})();

// Discrete (banded) colormaps — exact hex codes from the desktop version.
function _hexToRgb(h) {
  h = h.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const DISCRETE_CMAPS = {
  "5color": ["#A7E5BC", "#80CD8F", "#51B15A", "#00841F", "#006A00"].map(_hexToRgb),
  "7color": ["#0A0873", "#1212E4", "#7DA7D9", "#80CD8F", "#51B15A", "#00841F", "#006A00"].map(_hexToRgb),
};
// Number of bands for a discrete cmap (0 if continuous).
function cmapBands(name) {
  return DISCRETE_CMAPS[name] ? DISCRETE_CMAPS[name].length : 0;
}

function cmapLookup(name, t) {
  const disc = DISCRETE_CMAPS[name];
  if (disc) {
    const idx = Math.max(0, Math.min(disc.length - 1, Math.floor(t * disc.length - 1e-9)));
    return disc[idx];
  }
  const lut = CMAPS[name] || CMAPS.viridis;
  const i = Math.max(0, Math.min(255, Math.round(t * 255)));
  return [lut[3*i], lut[3*i+1], lut[3*i+2]];
}

function cmapNames() { return Object.keys(CMAPS); }

// ---------- Axes / canvas helpers ----------

// Compute "nice" tick step (~5-8 ticks across given range).
function niceStep(span, target = 7) {
  if (span <= 0) return 1;
  const raw = span / target;
  const exp = Math.floor(Math.log10(raw));
  const fr = raw / Math.pow(10, exp);
  let nice;
  if (fr < 1.5) nice = 1;
  else if (fr < 3.5) nice = 2;
  else if (fr < 7.5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exp);
}

function makeTicks(lo, hi, target = 7) {
  const step = niceStep(hi - lo, target);
  if (!(step > 0)) return [lo];
  // Generate ticks as integer multiples of `step` (one multiply each) instead
  // of accumulating `v += step`, which drifts and turns the 0 tick into noise
  // like 1.23e-17. Snap values within a step's rounding error back to 0.
  const firstIdx = Math.ceil(lo / step - 1e-9);
  const lastIdx = Math.floor(hi / step + 1e-9);
  const ticks = [];
  for (let i = firstIdx; i <= lastIdx; i++) {
    let v = i * step;
    if (Math.abs(v) < step * 1e-6) v = 0;
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

// Plot box layout. Returns { x, y, w, h } for the data area inside `rect`.
function plotBox(rect, opts = {}) {
  const padLeft = opts.padLeft ?? 60;
  const padRight = opts.padRight ?? 16;
  const padTop = opts.padTop ?? 20;
  const padBottom = opts.padBottom ?? 40;
  return {
    x: rect.x + padLeft,
    y: rect.y + padTop,
    w: Math.max(40, rect.w - padLeft - padRight),
    h: Math.max(40, rect.h - padTop - padBottom),
  };
}

// Coordinate transformer (data → pixel).
function makeTransform(box, xRange, yRange, flipY = true) {
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  return {
    box, xRange, yRange,
    toPx: (x, y) => ({
      x: box.x + ((x - xMin) / xSpan) * box.w,
      y: flipY ? box.y + box.h - ((y - yMin) / ySpan) * box.h
              : box.y + ((y - yMin) / ySpan) * box.h,
    }),
    fromPx: (px, py) => ({
      x: xMin + (px - box.x) / box.w * xSpan,
      y: flipY ? yMin + (box.y + box.h - py) / box.h * ySpan
              : yMin + (py - box.y) / box.h * ySpan,
    }),
  };
}

// Draw axes (frame + ticks + tick labels). Returns the plotBox.
function drawAxes(ctx, rect, opts = {}) {
  const box = opts.box || plotBox(rect, opts);
  const T = opts.transform || makeTransform(box, opts.xRange, opts.yRange);
  const xTicks = opts.xTicks ?? makeTicks(...T.xRange);
  const yTicks = opts.yTicks ?? makeTicks(...T.yRange);
  const tickFam = opts.tickFont || "system-ui";
  const tickSize = opts.tickFontSize || 11;
  const titleFam = opts.titleFont || "system-ui";
  const titleSize = opts.titleFontSize || 12;
  const frameLW = opts.frameLineWidth || 1;
  const tickLW = opts.tickLineWidth || 1;
  const tickStyle = `${opts.tickItalic ? "italic " : ""}${opts.tickBold ? "bold " : ""}`;
  const titleStyle = `${opts.titleItalic ? "italic " : ""}${opts.titleBold ? "bold " : ""}`;
  const fmtT = window.LUMOS_util.fmtTick;
  // Tick LABEL formatters can differ from tick POSITIONS (e.g. a log axis
  // positions ticks in log space but labels them with the original value).
  const xFmt = opts.xTickLabel || fmtT;
  const yFmt = opts.yTickLabel || fmtT;
  ctx.save();
  if (opts.fill !== false) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.strokeStyle = "#444";
  ctx.lineWidth = frameLW;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);

  ctx.fillStyle = "#222";
  ctx.font = `${tickStyle}${tickSize}px ${tickFam}`;
  ctx.lineWidth = tickLW;
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  for (const xt of xTicks) {
    const { x } = T.toPx(xt, T.yRange[0]);
    if (opts.hideTicks) continue;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, box.y + box.h);
    ctx.lineTo(x + 0.5, box.y + box.h + 4);
    ctx.stroke();
    ctx.fillText(xFmt(xt), x, box.y + box.h + 6);
  }
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (const yt of yTicks) {
    const { y } = T.toPx(T.xRange[0], yt);
    if (opts.hideTicks) continue;
    ctx.beginPath();
    ctx.moveTo(box.x, y + 0.5);
    ctx.lineTo(box.x - 4, y + 0.5);
    ctx.stroke();
    ctx.fillText(yFmt(yt), box.x - 6, y);
  }

  if (opts.title) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${titleStyle}${titleSize + 1}px ${titleFam}`;
    ctx.fillText(opts.title, box.x + box.w / 2, rect.y + 2);
  }
  if (opts.xlabel) {
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${titleStyle}${titleSize}px ${titleFam}`;
    // Place the x-title just below the tick numbers so larger fonts don't
    // collide with them (the caller sizes padBottom from the font sizes).
    ctx.fillText(opts.xlabel, box.x + box.w / 2, box.y + box.h + tickSize + 12);
  }
  if (opts.ylabel) {
    ctx.save();
    const lx = opts.ylabelX != null ? opts.ylabelX : rect.x + 12;
    ctx.translate(lx, box.y + box.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${titleStyle}${titleSize}px ${titleFam}`;
    ctx.fillText(opts.ylabel, 0, 0);
    ctx.restore();
  }
  ctx.restore();
  return { box, T };
}

// ---------- Heatmap (filled-contour-ish) ----------

// Renders a 2-D field Z (rows × cols), mapping values [zMin, zMax] to cmap.
// Drawn to an offscreen canvas at box size, then blitted with drawImage so it
// honours the main context's devicePixelRatio transform (putImageData would
// ignore the transform and land in the wrong place on HiDPI displays).
function drawHeatmap(ctx, box, xs, ys, Z, opts = {}) {
  const cmap = opts.cmap || "viridis";
  let zMin = opts.zMin, zMax = opts.zMax;
  if (zMin == null || zMax == null) {
    let mn = Infinity, mx = -Infinity;
    for (const row of Z) for (const v of row) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (zMin == null) zMin = mn;
    if (zMax == null) zMax = mx;
  }
  const zSpan = zMax - zMin || 1;
  const rows = Z.length;
  const cols = Z[0].length;
  const discrete = !!DISCRETE_CMAPS[cmap];
  // Continuous cmaps: paint at grid resolution and let drawImage smooth-upscale
  // (cheap). Discrete cmaps: paint at a higher resolution with bilinear sampling
  // so the banded edges follow the data smoothly instead of stair-stepping on
  // the coarse grid (blitted crisp, no smoothing).
  let W, H;
  if (discrete) {
    const cap = 440, a = (box.w / box.h) || 1;
    if (box.w >= box.h) { W = Math.min(cap, Math.max(1, Math.round(box.w))); H = Math.max(1, Math.round(W / a)); }
    else { H = Math.min(cap, Math.max(1, Math.round(box.h))); W = Math.max(1, Math.round(H * a)); }
  } else { W = cols; H = rows; }
  const off = document.createElement("canvas");
  off.width = W;
  off.height = H;
  const octx = off.getContext("2d");
  const img = octx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    const ridx = (1 - (H > 1 ? py / (H - 1) : 0)) * (rows - 1);  // top = high Y
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(ridx)));
    const r1 = Math.min(rows - 1, r0 + 1);
    const rt = ridx - r0;
    for (let px = 0; px < W; px++) {
      const cidx = (W > 1 ? px / (W - 1) : 0) * (cols - 1);
      const c0 = Math.max(0, Math.min(cols - 1, Math.floor(cidx)));
      const c1 = Math.min(cols - 1, c0 + 1);
      const ct = cidx - c0;
      const z = (Z[r0][c0] + (Z[r0][c1] - Z[r0][c0]) * ct) * (1 - rt)
              + (Z[r1][c0] + (Z[r1][c1] - Z[r1][c0]) * ct) * rt;
      const idx = 4 * (py * W + px);
      if (!Number.isFinite(z)) { img.data[idx + 3] = 0; continue; }
      const t = Math.max(0, Math.min(1, (z - zMin) / zSpan));
      const [rr, gg, bb] = cmapLookup(cmap, t);
      img.data[idx] = rr; img.data[idx + 1] = gg; img.data[idx + 2] = bb; img.data[idx + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = !discrete;
  ctx.drawImage(off, box.x, box.y, box.w, box.h);
  ctx.restore();
}

// Marching-squares iso-contour for a single level. Returns array of segments
// [[x1,y1,x2,y2], …] in DATA coordinates.
function isoContour(xs, ys, Z, level) {
  const segs = [];
  const rows = Z.length;
  const cols = xs.length;
  for (let i = 0; i < rows - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    for (let j = 0; j < cols - 1; j++) {
      const x0 = xs[j], x1 = xs[j + 1];
      const v00 = Z[i][j], v01 = Z[i][j + 1];
      const v10 = Z[i + 1][j], v11 = Z[i + 1][j + 1];
      if (![v00, v01, v10, v11].every(Number.isFinite)) continue;
      const a = v00 >= level ? 1 : 0;
      const b = v01 >= level ? 1 : 0;
      const c = v11 >= level ? 1 : 0;
      const d = v10 >= level ? 1 : 0;
      const code = (a << 3) | (b << 2) | (c << 1) | d;
      if (code === 0 || code === 15) continue;
      // Interpolated crossing on each edge (top, right, bottom, left).
      const top    = [lerpEdge(x0, x1, v00, v01, level), y0];
      const right  = [x1, lerpEdge(y0, y1, v01, v11, level)];
      const bottom = [lerpEdge(x0, x1, v10, v11, level), y1];
      const left   = [x0, lerpEdge(y0, y1, v00, v10, level)];
      // Lookup table
      switch (code) {
        case 1:  segs.push([...bottom, ...left]); break;
        case 2:  segs.push([...right, ...bottom]); break;
        case 3:  segs.push([...right, ...left]); break;
        case 4:  segs.push([...top, ...right]); break;
        case 5:  segs.push([...top, ...left]); segs.push([...bottom, ...right]); break;
        case 6:  segs.push([...top, ...bottom]); break;
        case 7:  segs.push([...top, ...left]); break;
        case 8:  segs.push([...top, ...left]); break;
        case 9:  segs.push([...top, ...bottom]); break;
        case 10: segs.push([...top, ...right]); segs.push([...bottom, ...left]); break;
        case 11: segs.push([...top, ...right]); break;
        case 12: segs.push([...right, ...left]); break;
        case 13: segs.push([...right, ...bottom]); break;
        case 14: segs.push([...bottom, ...left]); break;
      }
    }
  }
  return segs;
}

function lerpEdge(a, b, va, vb, level) {
  if (vb === va) return a;
  return a + (level - va) / (vb - va) * (b - a);
}

function drawContourLines(ctx, T, segments, color = "#000", lineWidth = 0.5) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segments) {
    const a = T.toPx(x1, y1);
    const b = T.toPx(x2, y2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- Colorbar (vertical) ----------

function drawColorbar(ctx, rect, cmap, zMin, zMax) {
  const w = 18;
  const x = rect.x + rect.w - w - 2;
  const y = rect.y;
  const h = rect.h;
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    const t = 1 - py / (h - 1);
    const [r, g, b] = cmapLookup(cmap, t);
    for (let px = 0; px < w; px++) {
      const i = 4 * (py * w + px);
      img.data[i + 0] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x, y);
  ctx.strokeStyle = "#444";
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);

  // Ticks
  ctx.fillStyle = "#222";
  ctx.font = "10px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const ticks = makeTicks(zMin, zMax, 5);
  for (const tv of ticks) {
    const t = (tv - zMin) / (zMax - zMin || 1);
    const ty = y + h - t * h;
    ctx.fillText(window.LUMOS_util.fmt(tv, 4), x + w + 4, ty);
    ctx.beginPath();
    ctx.moveTo(x + w, ty);
    ctx.lineTo(x + w + 3, ty);
    ctx.stroke();
  }
}

// ---------- Scatter / line ----------

// Marker rendering supports three modes via opts:
//   filled (default):  opts.fillColor (or opts.color)
//   filled + outline:  opts.fillColor + opts.strokeColor
//   hollow:            opts.fill === false + opts.strokeColor
function drawScatter(ctx, T, xs, ys, opts = {}) {
  const r = opts.markerSize || 3;
  const fillColor = opts.fill === false ? null : (opts.fillColor || opts.color || "#1f77b4");
  const strokeColor = opts.strokeColor || null;
  const sw = opts.strokeWidth || 1.2;
  ctx.save();
  if (fillColor) ctx.fillStyle = fillColor;
  if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = sw; }
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = T.toPx(x, y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if (fillColor) ctx.fill();
    if (strokeColor) ctx.stroke();
  }
  ctx.restore();
}

function drawLine(ctx, T, xs, ys, opts = {}) {
  const color = opts.color || "#1f77b4";
  const lineWidth = opts.lineWidth || 1.5;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
    const p = T.toPx(x, y);
    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

// ---------- Boxplot ----------

function drawBox(ctx, T, xCenter, halfWidth, stats, color = "#1f77b4") {
  const xLo = xCenter - halfWidth;
  const xHi = xCenter + halfWidth;
  const tQ1 = T.toPx(xLo, stats.q1);
  const tQ3 = T.toPx(xHi, stats.q3);
  ctx.save();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 1.2;
  ctx.fillStyle = hexAlpha(color, 0.35);
  // Box
  ctx.fillRect(tQ1.x, tQ3.y, tQ3.x - tQ1.x, tQ1.y - tQ3.y);
  ctx.strokeRect(tQ1.x + 0.5, tQ3.y + 0.5, tQ3.x - tQ1.x, tQ1.y - tQ3.y);
  // Median line
  const tQ2 = T.toPx(xCenter, stats.q2);
  ctx.beginPath();
  ctx.moveTo(tQ1.x, tQ2.y);
  ctx.lineTo(tQ3.x, tQ2.y);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1.8;
  ctx.stroke();
  // Whiskers
  const tWL = T.toPx(xCenter, stats.whiskerLow);
  const tWH = T.toPx(xCenter, stats.whiskerHigh);
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(tQ2.x, tQ1.y);
  ctx.lineTo(tQ2.x, tWL.y);
  ctx.moveTo(tQ2.x, tQ3.y);
  ctx.lineTo(tQ2.x, tWH.y);
  const wHalf = halfWidth * 0.4;
  const tWLa = T.toPx(xCenter - wHalf, stats.whiskerLow);
  const tWLb = T.toPx(xCenter + wHalf, stats.whiskerLow);
  const tWHa = T.toPx(xCenter - wHalf, stats.whiskerHigh);
  const tWHb = T.toPx(xCenter + wHalf, stats.whiskerHigh);
  ctx.moveTo(tWLa.x, tWLa.y);
  ctx.lineTo(tWLb.x, tWLb.y);
  ctx.moveTo(tWHa.x, tWHa.y);
  ctx.lineTo(tWHb.x, tWHb.y);
  ctx.stroke();
  ctx.restore();
}

function drawJitter(ctx, T, xCenter, halfWidth, values, color = "#1f77b4") {
  ctx.save();
  ctx.fillStyle = hexAlpha(color, 0.6);
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const dx = (Math.random() - 0.5) * halfWidth * 1.4;
    const p = T.toPx(xCenter + dx, v);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawMeanMarker(ctx, T, xCenter, halfWidth, mean, color = "#000") {
  const p = T.toPx(xCenter, mean);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  const arm = halfWidth * 0.6 * T.box.w / Math.max(1, T.xRange[1] - T.xRange[0]);
  ctx.moveTo(p.x - 6, p.y);
  ctx.lineTo(p.x + 6, p.y);
  ctx.stroke();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawOutliers(ctx, T, xCenter, values, color = "#444") {
  ctx.save();
  ctx.fillStyle = "none";
  ctx.strokeStyle = color;
  for (const v of values) {
    const p = T.toPx(xCenter, v);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function hexAlpha(hex, alpha) {
  if (!hex.startsWith("#")) return hex;
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Sets canvas pixel size accounting for devicePixelRatio so it's crisp.
function fitCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

window.LUMOS_plotting = {
  CMAPS,
  cmapLookup,
  cmapBands,
  cmapNames,
  niceStep, makeTicks,
  plotBox, makeTransform, drawAxes,
  drawHeatmap, isoContour, drawContourLines,
  drawColorbar,
  drawScatter, drawLine,
  drawBox, drawJitter, drawMeanMarker, drawOutliers,
  fitCanvas, hexAlpha,
};

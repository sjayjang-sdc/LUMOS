// Pure-JS numerical helpers: linear solve, polyfit, RBF, IDW, stats.
// All operate on plain arrays; nothing depends on numpy / scipy.
"use strict";

// ---------- Linear algebra (Gauss-Jordan elimination) ----------

// Solve Ax = b for x. A is N×N, b is length N. Returns array of length N.
// In-place modifies copies of A and b (originals untouched). Throws on
// singular system.
function linSolve(A, b) {
  const n = b.length;
  const M = A.map((row) => row.slice());
  const v = b.slice();
  for (let i = 0; i < n; i++) {
    // Partial pivot.
    let maxRow = i;
    let maxVal = Math.abs(M[i][i]);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(M[k][i]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }
    if (maxVal < 1e-15) {
      throw new Error("Singular matrix in linSolve");
    }
    if (maxRow !== i) {
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      [v[i], v[maxRow]] = [v[maxRow], v[i]];
    }
    // Eliminate below.
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      if (factor === 0) continue;
      for (let j = i; j < n; j++) M[k][j] -= factor * M[i][j];
      v[k] -= factor * v[i];
    }
  }
  // Back-substitution.
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = v[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// ---------- Polyfit (degree 1 — linear least squares only) ----------

// Returns [intercept, slope] such that y ≈ slope*x + intercept.
function polyfit1(xs, ys) {
  const n = xs.length;
  if (n < 2) throw new Error("polyfit1 needs at least 2 points");
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const det = n * sxx - sx * sx;
  if (Math.abs(det) < 1e-15) throw new Error("polyfit1: degenerate input");
  const slope = (n * sxy - sx * sy) / det;
  const intercept = (sy - slope * sx) / n;
  return [intercept, slope];
}

// ---------- RBF interpolation (multiquadric / gaussian / thin_plate) ----------

const RBF_KERNELS = {
  multiquadric: (r, eps) => Math.sqrt(r * r + eps * eps),
  inverse:      (r, eps) => 1 / Math.sqrt(r * r + eps * eps),
  gaussian:     (r, eps) => Math.exp(-(r * r) / (eps * eps)),
  thin_plate:   (r) => (r === 0 ? 0 : r * r * Math.log(r)),
};

// Build RBF interpolant from scattered points. Returns a function f(x, y).
function rbfFit(xk, yk, zk, kernelName = "multiquadric") {
  const n = xk.length;
  if (n < 1) throw new Error("rbfFit: empty input");
  if (n !== yk.length || n !== zk.length) {
    throw new Error("rbfFit: xk/yk/zk length mismatch");
  }
  const kernelFn = RBF_KERNELS[kernelName] || RBF_KERNELS.multiquadric;

  // Choose epsilon = mean nearest-neighbour distance (scipy default approx).
  let epsAccum = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    let nearest = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = xk[i] - xk[j];
      const dy = yk[i] - yk[j];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearest) nearest = d;
    }
    if (Number.isFinite(nearest)) { epsAccum += nearest; counted += 1; }
  }
  const eps = counted > 0 ? epsAccum / counted : 1;

  // Build kernel matrix.
  const A = Array.from({ length: n }, () => new Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = xk[i] - xk[j];
      const dy = yk[i] - yk[j];
      const r = Math.sqrt(dx * dx + dy * dy);
      A[i][j] = kernelFn(r, eps);
    }
  }
  // Diagonal regularisation to keep system non-singular at coincident points.
  for (let i = 0; i < n; i++) A[i][i] += 1e-10;

  const weights = linSolve(A, zk);

  return function evaluate(x, y) {
    let v = 0;
    for (let j = 0; j < n; j++) {
      const dx = x - xk[j];
      const dy = y - yk[j];
      const r = Math.sqrt(dx * dx + dy * dy);
      v += weights[j] * kernelFn(r, eps);
    }
    return v;
  };
}

// ---------- IDW (inverse distance weighted) ----------

// Returns ZI grid (rows = yi, cols = xi).
function idwGrid(xk, yk, zk, xi, yi, power = 2.0, smoothFrac = 0.0) {
  let xmn = Infinity, xmx = -Infinity, ymn = Infinity, ymx = -Infinity;
  for (let i = 0; i < xk.length; i++) {
    if (xk[i] < xmn) xmn = xk[i]; if (xk[i] > xmx) xmx = xk[i];
    if (yk[i] < ymn) ymn = yk[i]; if (yk[i] > ymx) ymx = yk[i];
  }
  const xspan = xmx - xmn;
  const yspan = ymx - ymn;
  const diag = Math.hypot(xspan, yspan);
  const delta = smoothFrac * diag;
  const deltaP = Math.pow(delta, power);

  const Z = new Array(yi.length);
  for (let r = 0; r < yi.length; r++) {
    const yy = yi[r];
    const row = new Array(xi.length);
    for (let c = 0; c < xi.length; c++) {
      const xx = xi[c];
      // Snap if smoothFrac==0 and target coincides with a source.
      let wSum = 0, vSum = 0, exact = NaN;
      for (let i = 0; i < xk.length; i++) {
        const dx = xx - xk[i];
        const dy = yy - yk[i];
        const d2 = dx * dx + dy * dy;
        if (d2 === 0) { exact = zk[i]; break; }
        const w = 1 / (Math.pow(Math.sqrt(d2), power) + deltaP);
        wSum += w;
        vSum += w * zk[i];
      }
      row[c] = Number.isFinite(exact) ? exact : vSum / wSum;
    }
    Z[r] = row;
  }
  return Z;
}

// ---------- Statistics ----------

function stats(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length === 0) {
    return { n: 0, mean: NaN, max: NaN, min: NaN, range: NaN, std: NaN, unif: NaN };
  }
  const n = xs.length;
  let sum = 0;
  let mn = +Infinity;
  let mx = -Infinity;
  for (const v of xs) {
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const mean = sum / n;
  let sse = 0;
  for (const v of xs) sse += (v - mean) ** 2;
  const std = Math.sqrt(sse / n);  // population std (matches numpy.std default)
  const range = mx - mn;
  const unif = (mx + mn !== 0) ? 100 * (mx - mn) / (mx + mn) : NaN;
  return { n, mean, max: mx, min: mn, range, std, unif };
}

function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return NaN;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function quantile(sortedXs, q) {
  if (sortedXs.length === 0) return NaN;
  const pos = (sortedXs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedXs[lo];
  return sortedXs[lo] + (sortedXs[hi] - sortedXs[lo]) * (pos - lo);
}

// Tukey-style box plot stats from a list of values.
// Returns { q1, q2, q3, iqr, whiskerLow, whiskerHigh, outliers[], min, max, mean }
function boxplotStats(values) {
  const xs = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const q1 = quantile(xs, 0.25);
  const q2 = quantile(xs, 0.5);
  const q3 = quantile(xs, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  let whiskerLow = xs[0], whiskerHigh = xs[xs.length - 1];
  const outliers = [];
  for (const v of xs) {
    if (v < lo) outliers.push(v);
    else if (v > hi) outliers.push(v);
  }
  for (const v of xs) {
    if (v >= lo) { whiskerLow = v; break; }
  }
  for (let i = xs.length - 1; i >= 0; i--) {
    if (xs[i] <= hi) { whiskerHigh = xs[i]; break; }
  }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    q1, q2, q3, iqr,
    whiskerLow, whiskerHigh,
    outliers,
    min: xs[0], max: xs[xs.length - 1],
    mean,
    n: xs.length,
  };
}

// linspace
function linspace(a, b, n) {
  if (n <= 1) return [a];
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => a + step * i);
}

window.LUMOS_numerics = {
  linSolve, polyfit1,
  rbfFit, idwGrid,
  stats, median, quantile, boxplotStats,
  linspace,
};

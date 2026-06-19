// Tab-separated / CSV parsing helpers + the Map's two-format parser
// (3-column long form vs 2D pivot table) — mirror of LUMOS_map.parse_data.
"use strict";

function detectSep(text) {
  // Heuristic: pick whichever of \t / , is most common per line.
  const first = text.split(/\r?\n/, 1)[0] || "";
  const tabs = (first.match(/\t/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  if (tabs >= commas) return "\t";
  return ",";
}

function parseTable(text, sep = null) {
  if (!text || !text.trim()) return [];
  sep = sep || detectSep(text);
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    rows.push(line.split(sep));
  }
  return rows;
}

function asNumberMatrix(rows) {
  return rows.map((r) => r.map((cell) => {
    const n = Number(String(cell).trim());
    return Number.isFinite(n) ? n : NaN;
  }));
}

// Cheap pre-flight size estimate WITHOUT allocating the full cell matrix —
// counts newlines and the first line's column count. Used to refuse oversized
// pastes before parseTable() allocates millions of strings (which can OOM-crash
// the tab before any post-parse guard runs).
function estimateCells(text) {
  if (!text) return { rows: 0, cols: 0, cells: 0 };
  const nlIdx = text.indexOf("\n");
  const firstLine = nlIdx >= 0 ? text.slice(0, nlIdx) : text;
  const sep = detectSep(text);
  const cols = firstLine.split(sep).length;
  let rows = text.length && text[text.length - 1] !== "\n" ? 1 : 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) rows++;
  return { rows, cols, cells: rows * cols };
}

// Map data parser. Accepts:
//   - 3-column long form (x, y, z) with optional header row
//   - 2-D pivot (header row of X, header col of Y, body of Z)
// Returns { xs: number[], ys: number[], Z: number[][] }.
function parseMapData(text) {
  const rows = parseTable(text);
  if (rows.length === 0) {
    throw new Error("Pasted data is empty.");
  }

  let ncols = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].length > ncols) ncols = rows[i].length;

  // Disambiguation: if the top-left cell is empty AND the first row has
  // numeric values from column 1 onward, treat as 2D pivot regardless
  // of column count. Catches small 2×2 maps that would otherwise be
  // misdispatched as a 3-row "long form".
  const tlCell = String(rows[0][0] ?? "").trim();
  const looksLike2D =
    rows.length > 1 &&
    ncols > 1 &&
    tlCell === "" &&
    rows[0].slice(1).every((c) => Number.isFinite(Number(c)));

  if (!looksLike2D && ncols === 3) {
    // 3-column long form. Detect header.
    let body = rows;
    const first = rows[0];
    const firstNumeric = first.every((c) => Number.isFinite(Number(String(c).trim())));
    if (!firstNumeric) body = rows.slice(1);

    const num = (c) => { const s = String(c == null ? "" : c).trim(); return s === "" ? NaN : Number(s); };
    const triples = [];
    for (const r of body) {
      if (r.length < 3) continue;
      const x = num(r[0]);
      const y = num(r[1]);
      const z = num(r[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      triples.push([x, y, z]);
    }
    if (triples.length === 0) {
      throw new Error("No valid X,Y,Z rows found.");
    }
    return pivotLong(triples);
  }

  if (rows.length > 1 && ncols > 1) {
    // 2-D pivot: top-left empty/non-numeric, first row = X, first col = Y.
    const tl = String(rows[0][0] || "").trim();
    if (tl !== "" && Number.isFinite(Number(tl))) {
      throw new Error(
        "Unsupported 2D format. Top-left cell must be empty or non-numeric."
      );
    }
    const xs = rows[0].slice(1).map((c) => Number(c));
    const ys = [];
    const Z = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      ys.push(Number(r[0]));
      const zr = [];
      for (let j = 1; j < xs.length + 1; j++) {
        // Empty / blank cells are missing data (NaN) — NOT 0. Number("") is 0,
        // which would otherwise fill the gaps with spurious zeros.
        const cell = j < r.length ? String(r[j]).trim() : "";
        zr.push(cell === "" ? NaN : Number(cell));
      }
      Z.push(zr);
    }
    if (xs.some((v) => !Number.isFinite(v))) {
      throw new Error("X header row contains non-numeric values.");
    }
    if (ys.some((v) => !Number.isFinite(v))) {
      throw new Error("Y header column contains non-numeric values.");
    }
    return { xs, ys, Z };
  }

  throw new Error("Unsupported data shape.");
}

// Multi-Z map parser. Accepts:
//   - 2D pivot (single Z) — handled by parseMapData
//   - long form x, y, z1, z2, … (one or more Z columns)
// Returns { zNames: string[], rawByZ: number[][][] } where rawByZ[i] is the
// list of finite [x, y, z] triples for the i-th Z column.
function parseMapDataMulti(text) {
  const rows = parseTable(text);
  if (rows.length === 0) throw new Error("Pasted data is empty.");
  let ncols = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].length > ncols) ncols = rows[i].length;
  const tlCell = String(rows[0][0] ?? "").trim();
  const looksLike2D =
    rows.length > 1 && ncols > 1 && tlCell === "" &&
    rows[0].slice(1).every((c) => Number.isFinite(Number(c)));

  // Single-Z: a 2D pivot, or anything with < 3 columns (reuse the base parser,
  // which also disambiguates small pivots and errors on bad shapes).
  if (looksLike2D || ncols < 3) {
    const { xs, ys, Z } = parseMapData(text);
    const triples = [];
    for (let r = 0; r < ys.length; r++) {
      for (let c = 0; c < xs.length; c++) {
        const z = Z[r][c];
        if (Number.isFinite(z)) triples.push([xs[c], ys[r], z]);
      }
    }
    if (!triples.length) throw new Error("No valid (x, y, z) points found.");
    return { zNames: ["Z"], rawByZ: [triples] };
  }

  // Long form: x, y, z1, z2, … (≥ 3 columns, not a 2D pivot).
  const first = rows[0];
  const firstNumeric = first.every((c) => { const s = String(c).trim(); return s !== "" && Number.isFinite(Number(s)); });
  let header = null, body = rows;
  if (!firstNumeric) { header = first.map((c) => String(c).trim()); body = rows.slice(1); }
  const nz = ncols - 2;
  const zNames = [];
  for (let i = 0; i < nz; i++) zNames.push((header && header[2 + i]) ? header[2 + i] : `z${i + 1}`);
  const rawByZ = Array.from({ length: nz }, () => []);
  const num = (c) => { const s = String(c == null ? "" : c).trim(); return s === "" ? NaN : Number(s); };
  for (const r of body) {
    if (r.length < 3) continue;
    const x = num(r[0]), y = num(r[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    for (let i = 0; i < nz; i++) {
      const z = num(r[2 + i]);
      if (Number.isFinite(z)) rawByZ[i].push([x, y, z]);
    }
  }
  if (rawByZ.every((t) => t.length === 0)) throw new Error("No valid x, y, z rows found.");
  return { zNames, rawByZ };
}

// Aggregate long-form (x, y, z) into a pivoted { xs, ys, Z }. Cells
// with multiple measurements get averaged (mimics pandas pivot_table).
function pivotLong(triples) {
  const xs = Array.from(new Set(triples.map((t) => t[0]))).sort((a, b) => a - b);
  const ys = Array.from(new Set(triples.map((t) => t[1]))).sort((a, b) => a - b);
  const xi = new Map(xs.map((x, i) => [x, i]));
  const yi = new Map(ys.map((y, i) => [y, i]));
  const sum = Array.from({ length: ys.length }, () => new Array(xs.length).fill(0));
  const count = Array.from({ length: ys.length }, () => new Array(xs.length).fill(0));
  for (const [x, y, z] of triples) {
    const r = yi.get(y);
    const c = xi.get(x);
    sum[r][c] += z;
    count[r][c] += 1;
  }
  const Z = sum.map((row, r) => row.map((s, c) => count[r][c] === 0 ? NaN : s / count[r][c]));
  return { xs, ys, Z };
}

// Apply round/truncate to a value array (mirrors snap_series in LUMOS_map.py).
// nDigits is the SPINBOX-CONVENTION number (positive = drop trailing
// integer digits, negative = decimal precision). 0 means leave alone.
function snapValues(arr, n, mode) {
  if (n === 0) return arr.slice();
  const factor = Math.pow(10, n);
  if (mode === "Truncate") {
    return arr.map((v) => Math.trunc(v / factor) * factor);
  }
  // Round half to even (banker) — approximate with normal round
  return arr.map((v) => {
    if (n >= 0) return Math.round(v / factor) * factor;
    // n < 0 : equivalent to round(v, -n)
    const f2 = Math.pow(10, -n);
    return Math.round(v * f2) / f2;
  });
}

// Re-pivot a list of triples after applying snap.
function snapAndPivot(triples, nx, ny, mode) {
  const sx = (v) => {
    if (nx === 0) return v;
    const factor = Math.pow(10, nx);
    return mode === "Truncate"
      ? Math.trunc(v / factor) * factor
      : (nx >= 0 ? Math.round(v / factor) * factor : Math.round(v * Math.pow(10, -nx)) / Math.pow(10, -nx));
  };
  const sy = (v) => {
    if (ny === 0) return v;
    const factor = Math.pow(10, ny);
    return mode === "Truncate"
      ? Math.trunc(v / factor) * factor
      : (ny >= 0 ? Math.round(v / factor) * factor : Math.round(v * Math.pow(10, -ny)) / Math.pow(10, -ny));
  };
  const snapped = triples.map(([x, y, z]) => [sx(x), sy(y), z]);
  return pivotLong(snapped);
}

window.LUMOS_parse = {
  parseTable,
  estimateCells,
  parseMapData,
  parseMapDataMulti,
  pivotLong,
  snapValues,
  snapAndPivot,
};

// Tiny DOM / event / formatting helpers used across all tabs.
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) e.setAttribute(k, "");
    else if (v === false || v == null) {/* skip */}
    else e.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    if (typeof child === "string") e.appendChild(document.createTextNode(child));
    else e.appendChild(child);
  }
  return e;
}

function setStatus(text, type = "") {
  const sb = $("#status-text");
  if (sb) {
    const i18n = window.LUMOS_i18n;
    sb.textContent = (i18n && i18n.msg) ? i18n.msg(text) : text;
    sb.className = type ? `${type}-text` : "";
  }
}

function fmt(n, precision = 6) {
  if (!Number.isFinite(n)) return "—";
  // Compact %g-like format
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) {
    return n.toExponential(precision - 1);
  }
  return Number(n.toPrecision(precision)).toString();
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Compact axis-tick label: trims trailing zeros and uses short exponential
// for very large/small magnitudes so neighbouring ticks don't collide
// (e.g. 1.0000e+17 -> 1e17, 1.5000e+17 -> 1.5e17, 0.300000 -> 0.3).
function fmtSci(v, sig = 6) {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  let [m, e] = v.toExponential(sig - 1).split("e");
  if (m.indexOf(".") >= 0) m = m.replace(/0+$/, "").replace(/\.$/, "");
  return `${m}e${parseInt(e, 10)}`;
}
function fmtDec(v, sig = 6) {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  return String(Number(v.toPrecision(sig)));
}
function fmtTick(v, sig = 6) {
  if (!Number.isFinite(v)) return "";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  return (abs < 1e-4 || abs >= 1e6) ? fmtSci(v, sig) : fmtDec(v, sig);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Promise-friendly setTimeout
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Debounce — returns a function that delays calling fn until ms have
// elapsed since the last call.
function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Copy text to clipboard. Returns true on success.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback for older browsers / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      return true;
    } catch (e2) {
      return false;
    } finally {
      ta.remove();
    }
  }
}

// Trigger download of `text` as a file.
function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Convert a canvas to PNG and trigger download.
function downloadCanvasPNG(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

// Read clipboard text via navigator.clipboard (requires user gesture).
async function readClipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch (e) {
    return null;
  }
}

// Track the clipboard-read permission so callers can decide whether reading the
// clipboard will prompt. Querying does NOT show a prompt; we only auto-use
// readText() (e.g. for Ctrl+V) when it's already "granted", so users aren't
// nagged with allow/block dialogs on every paste.
let _clipReadGranted = false;
(function trackClipPerm() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "clipboard-read" }).then((st) => {
        _clipReadGranted = st.state === "granted";
        try { st.onchange = () => { _clipReadGranted = st.state === "granted"; }; } catch (e) { /* noop */ }
      }).catch(() => { /* unsupported */ });
    }
  } catch (e) { /* unsupported */ }
})();
function clipboardReadGranted() { return _clipReadGranted; }

// Show a busy overlay, let the browser paint it (two rAFs), run the blocking
// `work`, then hide the overlay two frames later so the trailing layout/paint
// of the work is still covered by the spinner. Used by the data-loading paths.
function runWithBusy(overlayEl, work) {
  const raf = window.requestAnimationFrame.bind(window);
  if (overlayEl) overlayEl.classList.add("show");
  const hide = () => raf(() => raf(() => { if (overlayEl) overlayEl.classList.remove("show"); }));
  raf(() => raf(() => {
    try { work(); } finally { hide(); }
  }));
}

// Markup for the loading overlay (spinner + label), reused across tabs.
function busyOverlay(id) {
  return el("div", { class: "plot-busy", id }, [
    el("div", { class: "busy-card" }, [el("div", { class: "spinner" }), el("div", { class: "busy-text" }, "Loading data…")]),
  ]);
}

window.LUMOS_util = {
  $, $$, el, setStatus, fmt, fmtTick, fmtSci, fmtDec, clamp, lerp, sleep, debounce,
  copyToClipboard, downloadText, downloadCanvasPNG, readClipboardText,
  clipboardReadGranted,
  runWithBusy, busyOverlay,
};

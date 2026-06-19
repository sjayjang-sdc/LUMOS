// Lightweight diagnostic logger. Browser pages can't write files to disk, so
// entries are kept in localStorage (they survive a tab crash / "Aw, Snap") and
// can be downloaded from Preferences → General. Each entry records the JS heap
// usage (Chromium) so we can see how close to the memory limit we got before a
// crash. Toggle via Preferences → General (on by default).
"use strict";

(function () {
  const KEY = "lumos_log";
  const MAX_ENTRIES = 800;
  let enabled = true;
  try {
    const c = window.LUMOS_config && window.LUMOS_config.load();
    if (c && c.logging_enabled === false) enabled = false;
  } catch (e) { /* default on */ }

  let buf = [];
  try { const raw = localStorage.getItem(KEY); if (raw) buf = JSON.parse(raw) || []; } catch (e) { buf = []; }
  // The tiny per-line key persists more reliably than the big buffer; if it
  // holds a line the buffer never captured, that's the last step before a
  // hard crash — surface it so it isn't lost.
  try {
    const last = localStorage.getItem(KEY + "_last");
    if (last && (!buf.length || buf[buf.length - 1] !== last)) buf.push("*** recovered last line before crash/reload: " + last);
  } catch (e) { /* noop */ }

  function heapStr() {
    try {
      const m = window.performance && window.performance.memory;
      if (!m) return "";
      const mb = (x) => Math.round(x / 1048576);
      return ` heap=${mb(m.usedJSHeapSize)}/${mb(m.jsHeapSizeLimit)}MB`;
    } catch (e) { return ""; }
  }
  function flush() { try { localStorage.setItem(KEY, JSON.stringify(buf)); } catch (e) { /* quota / private mode */ } }

  function log(msg, extra) {
    if (!enabled) return;
    const t = new Date().toISOString().slice(11, 23);
    let line = `[${t}] ${msg}${heapStr()}`;
    if (extra != null) line += " | " + (typeof extra === "string" ? extra : JSON.stringify(extra));
    buf.push(line);
    if (buf.length > MAX_ENTRIES) buf = buf.slice(-MAX_ENTRIES);
    flush();                                  // synchronous → usually survives a crash
    try { localStorage.setItem(KEY + "_last", line); } catch (e) { /* noop */ }
    // console.log (not debug) so it shows in DevTools by default — the console
    // log survives a hard renderer crash ("Aw, Snap") when localStorage may not.
    try { if (window.console) console.log("LUMOS", line); } catch (e) { /* noop */ }
  }

  window.LUMOS_log = {
    log,
    dump: () => buf.join("\n"),
    clear: () => { buf = []; flush(); },
    setEnabled: (b) => { enabled = !!b; if (enabled) log("logging enabled"); },
    isEnabled: () => enabled,
  };

  try { log("=== session start ===", { ua: (navigator && navigator.userAgent) || "?" }); } catch (e) { /* noop */ }
})();

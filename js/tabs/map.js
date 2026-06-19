// Map Generator tab — port of LUMOS_map.py. Layout:
//   [section nav] [active section] [Map/Table tabbed view]
// Paste (x,y,z) long form or 2D pivot -> RBF/IDW interpolation -> filled
// heatmap (equal 1:1 aspect, size slider) + contour + scatter + value labels
// + colorbar (bar / split / off) + stats. Data table on its own view tab.
"use strict";

(function () {
  const U = window.LUMOS_util;
  const { el, $, $$, setStatus } = U;
  const P = window.LUMOS_parse;
  const N = window.LUMOS_numerics;
  const PL = window.LUMOS_plotting;

  const FONTS = ["system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "monospace"];
  const CMAP_OPTIONS = [
    ["viridis", "Viridis"], ["plasma", "Plasma"], ["inferno", "Inferno"], ["magma", "Magma"],
    ["cividis", "Cividis"], ["coolwarm", "Coolwarm"], ["RdYlBu_r", "RdYlBu (rev)"], ["jet", "Jet"],
    ["seismic", "Seismic"], ["hot", "Hot"], ["5color", "5-step"], ["7color", "7-step"],
  ];
  const INTERP_OPTIONS = [
    ["rbf_multiquadric", "RBF — Multiquadric"],
    ["rbf_thin_plate", "RBF — Thin plate"],
    ["rbf_gaussian", "RBF — Gaussian"],
    ["idw", "IDW (Inverse Distance, p=2)"],
  ];

  let _state = null;         // { zNames, rawByZ, pivots }
  let _persist = null;
  let _interpCache = new Map(); // per-Z interpolation cache, keyed by data/swap/method/idw
  let _pivotVersion = 0;     // bumped when the source grid (load / snap) changes
  let _tableZ = 0;           // active Z tab in the 2D table view

  // ---------- element helpers ----------

  // Loop-based min/max — Math.min(...arr) blows the call stack on large arrays.
  function arrMin(a) { let m = Infinity; for (let i = 0; i < a.length; i++) if (a[i] < m) m = a[i]; return m; }
  function arrMax(a) { let m = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m; }

  function block(title, children) {
    return el("div", { class: "dp-block" }, [el("h4", {}, title)].concat(children));
  }
  function prefRow(label, input) {
    return el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, label), input]);
  }
  function selectEl(id, opts) {
    const s = el("select", { id });
    opts.forEach(([v, lbl]) => s.appendChild(el("option", { value: v }, lbl)));
    return s;
  }
  function numEl(id, val, attrs) {
    const e = el("input", { type: "number", id, value: String(val) });
    attrs = attrs || {};
    if (attrs.step != null) e.setAttribute("step", attrs.step);
    if (attrs.min != null) e.setAttribute("min", attrs.min);
    if (attrs.max != null) e.setAttribute("max", attrs.max);
    return e;
  }
  function chk(id, checked, label) {
    return el("label", { style: "display:block;" }, [
      checked ? el("input", { type: "checkbox", id, checked: true }) : el("input", { type: "checkbox", id }),
      " " + label,
    ]);
  }
  function colorEl(id, val) { return el("input", { type: "color", id, value: val }); }
  function txtEl(id, ph) { return el("input", { type: "text", id, placeholder: ph || "" }); }
  function radio(name, val, label, checked) {
    return el("label", {}, [
      checked ? el("input", { type: "radio", name, value: val, checked: true }) : el("input", { type: "radio", name, value: val }),
      " " + label,
    ]);
  }
  // Fixed-decimal value formatter for value labels + legend (scientific for
  // very large / very small magnitudes so it stays compact).
  function fmtN(v, d) {
    if (!Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-4)) return v.toExponential(d);
    return v.toFixed(d);
  }
  function decimals() {
    return Math.max(0, Math.min(8, Number($("#map-decimals").value) || 3));
  }

  // ---------- UI ----------

  function buildUI(root) {
    root.innerHTML = "";
    const layout = el("div", { class: "dp-layout" });
    root.appendChild(layout);

    // Column 1: nav
    const nav = el("ul", { class: "dp-nav", id: "map-nav" });
    [["data", "Data"], ["interp", "Interpolation"], ["style", "Style"]]
      .forEach(([id, label], i) => {
        const li = el("li", { "data-sec": id, class: i === 0 ? "active" : "" }, label);
        li.addEventListener("click", () => showSection(id));
        nav.appendChild(li);
      });
    layout.appendChild(nav);

    // Column 2: sections
    const panel = el("div", { class: "dp-sections", id: "map-sections" });
    layout.appendChild(panel);

    panel.appendChild(el("div", { class: "dp-section active", "data-sec": "data" }, [
      el("div", { class: "hint" }, "3-col (x, y, z1, z2…) or 2D pivot table."),
      el("textarea", { id: "map-input", rows: 8, placeholder: "x\ty\tz\n0\t0\t1.0\n..." }),
      el("div", { class: "pref-hint", style: "margin:0 0 6px;" }, "For large Excel data use “Paste from clipboard” (Ctrl+V can choke on Excel’s hidden HTML copy)."),
      el("div", { class: "row" }, [
        el("button", { id: "map-clip", class: "primary" }, "Paste from clipboard"),
        el("button", { id: "map-load" }, "Load textarea"),
        el("button", { id: "map-reset" }, "Reset"),
      ]),
    ]));

    panel.appendChild(el("div", { class: "dp-section", "data-sec": "interp" }, [
      block("Interpolation", [
        prefRow("Method", selectEl("map-interp", INTERP_OPTIONS)),
        prefRow("IDW smoothing", numEl("map-idw", 0.05, { min: 0, max: 0.5, step: 0.01 })),
        el("div", { class: "pref-hint" }, "RBF auto-falls back to IDW above ~200 points. IDW smoothing only affects IDW."),
      ]),
      block("Snap coords", [
        chk("map-snap-enable", false, "Enable snap"),
        prefRow("Round X", numEl("map-snap-x", 0, { min: -10, max: 10, step: 1 })),
        prefRow("Round Y", numEl("map-snap-y", 0, { min: -10, max: 10, step: 1 })),
        prefRow("Mode", selectEl("map-snap-mode", [["Round", "Round"], ["Truncate", "Truncate"]])),
        el("div", { class: "pref-hint" }, "0 = Off. Positive N drops N trailing integer digits (μm coords); negative N keeps |N| decimals."),
      ]),
    ]));

    panel.appendChild(el("div", { class: "dp-section", "data-sec": "style" }, [
      block("Layout", [
        prefRow("Columns", numEl("map-cols", 2, { min: 1, max: 8 })),
        el("label", { class: "hint" }, ["Map size ",
          el("input", { type: "range", id: "map-size", min: 30, max: 100, value: 100, step: 1, style: "vertical-align:middle;" }),
        ]),
        el("div", { class: "pref-hint" }, "Multiple Z columns (x, y, z1, z2, …) draw one map each; Columns sets the grid width." ),
      ]),
      block("Colormap", [
        prefRow("Scheme", selectEl("map-cmap", CMAP_OPTIONS)),
        chk("map-contour", true, "Contour lines"),
      ]),
      block("Color range", [
        chk("map-manual-mm", false, "Manual min / max"),
        prefRow("Min", txtEl("map-vmin", "auto")),
        prefRow("Max", txtEl("map-vmax", "auto")),
      ]),
      block("Legend", [
        el("div", { class: "row" }, [
          radio("map-legend", "bar", "Bar", true),
          radio("map-legend", "split", "Split"),
          radio("map-legend", "off", "Off"),
        ]),
        prefRow("Legend font", selectEl("map-legend-font", FONTS.map((f) => [f, f]))),
        prefRow("Legend size", numEl("map-legend-size", 10, { min: 6, max: 30 })),
        chk("map-legend-bold", false, "Legend bold"),
      ]),
      block("Axes & font", [
        chk("map-hide-ticks", false, "Hide ticks"),
        chk("map-swap", false, "Swap X / Y"),
        prefRow("Tick font", selectEl("map-tick-font", FONTS.map((f) => [f, f]))),
        prefRow("Tick size", numEl("map-tick-size", 11, { min: 6, max: 40 })),
        chk("map-tick-bold", false, "Tick bold"),
        prefRow("Frame width", numEl("map-frame-lw", 1, { min: 0.5, max: 6, step: 0.5 })),
      ]),
      block("Points", [
        chk("map-point-show", true, "Show data points"),
        prefRow("Point size", numEl("map-point-size", 3, { min: 0, max: 20, step: 0.5 })),
        prefRow("Point fill", colorEl("map-point-fill", "#111111")),
        chk("map-point-outline", true, "Point outline"),
        prefRow("Outline color", colorEl("map-point-outline-color", "#ffffff")),
      ]),
      block("Values", [
        chk("map-values", false, "Show values"),
        prefRow("Size", numEl("map-value-size", 9, { min: 5, max: 30 })),
        prefRow("Color", colorEl("map-value-color", "#ffffff")),
        chk("map-value-bold", true, "Bold"),
        chk("map-value-inward", true, "Push inward at edges"),
        prefRow("Decimals", numEl("map-decimals", 3, { min: 0, max: 8 })),
        el("div", { class: "pref-hint" }, "Decimal places for value labels and the legend."),
      ]),
    ]));

    // Column 3: tabbed view (Map / Table)
    const col = el("div", { class: "dp-canvas-col" });
    col.appendChild(el("ul", { class: "map-tabs", id: "map-tabs" }, [
      el("li", { "data-pane": "map", class: "active" }, "Map"),
      el("li", { "data-pane": "table" }, "Table"),
    ]));

    // Map pane — one bordered cell per Z, each with its own Copy / Save.
    col.appendChild(el("div", { class: "map-pane active", "data-pane": "map" }, [
      el("div", { class: "dp-actions" }, [
        el("span", { class: "hint" }, "Each map has its own Copy / Save button (top-right)."),
        el("span", { class: "spacer" }),
        el("span", { id: "map-info", class: "hint" }, ""),
      ]),
      el("div", { class: "plot-area", id: "map-plot-area" }, [el("div", { id: "map-plots" }), U.busyOverlay("map-busy")]),
    ]));

    // Table pane
    col.appendChild(el("div", { class: "map-pane", "data-pane": "table" }, [
      el("div", { class: "dp-actions" }, [
        radio("map-tv", "2D", "2D pivot", true),
        radio("map-tv", "3-Col", "3-Col (x, y, z…)"),
        radio("map-tv", "Stats", "Stats"),
        el("span", { class: "spacer" }),
        el("button", { id: "map-copy-table" }, "Copy table"),
      ]),
      el("ul", { class: "map-tabs", id: "map-ztabs" }),
      el("div", { class: "table-container", id: "map-table-host", style: "flex:1;" }),
    ]));

    layout.appendChild(col);
  }

  function showSection(id) {
    $$("#map-nav li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-sec") === id));
    $$("#map-sections .dp-section").forEach((s) => s.classList.toggle("active", s.getAttribute("data-sec") === id));
  }
  function activePane() {
    const li = $$("#map-tabs li").find((x) => x.classList.contains("active"));
    return li ? li.getAttribute("data-pane") : "map";
  }
  function showPane(name) {
    $$("#map-tabs li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-pane") === name));
    $$(".map-pane").forEach((p) => p.classList.toggle("active", p.getAttribute("data-pane") === name));
    if (name === "map" && _state) window.requestAnimationFrame(render);
    if (name === "table") renderTable();
  }

  // ---------- settings ----------

  function restoreSettings() {
    const ms = window.LUMOS_config.load().map_settings || {};
    const setV = (id, v) => { const e = $("#" + id); if (e != null && v != null) e.value = v; };
    const setC = (id, v) => { const e = $("#" + id); if (e) e.checked = !!v; };
    setV("map-interp", ms.interpolation_method || "rbf_multiquadric");
    setV("map-idw", ms.idw_smoothing != null ? ms.idw_smoothing : 0.05);
    setV("map-cmap", ms.colormap || "viridis");
    setC("map-contour", ms.show_contour_lines !== false);
    setC("map-manual-mm", ms.manual_minmax);
    setC("map-hide-ticks", ms.hide_ticks);
    setC("map-swap", ms.swap_xy);
    setV("map-tick-font", ms.tick_font || "system-ui");
    setV("map-tick-size", ms.tick_font_size != null ? ms.tick_font_size : 11);
    setC("map-tick-bold", ms.tick_bold);
    setV("map-frame-lw", ms.frame_line_width != null ? ms.frame_line_width : 1);
    setV("map-legend-font", ms.legend_font || "system-ui");
    setV("map-legend-size", ms.legend_font_size != null ? ms.legend_font_size : 10);
    setC("map-legend-bold", ms.legend_bold);
    setV("map-size", ms.plot_size != null ? ms.plot_size : 100);
    setV("map-cols", ms.map_columns != null ? ms.map_columns : 2);
    $$('input[name="map-legend"]').forEach((r) => { r.checked = r.value === (ms.legend_style || "bar"); });
    setC("map-values", ms.value_show);
    setV("map-value-size", ms.value_fontsize != null ? ms.value_fontsize : 9);
    setV("map-value-color", ms.value_color || "#ffffff");
    setC("map-value-bold", ms.value_bold !== false);
    setC("map-value-inward", ms.value_auto_inward !== false);
    setV("map-decimals", ms.value_decimals != null ? ms.value_decimals : 3);
    setC("map-point-show", ms.point_show !== false);
    setV("map-point-size", ms.point_size != null ? ms.point_size : 3);
    setV("map-point-fill", ms.point_fill || "#111111");
    setC("map-point-outline", ms.point_outline !== false);
    setV("map-point-outline-color", ms.point_outline_color || "#ffffff");
    setC("map-snap-enable", ms.snap_coords_enabled);
    setV("map-snap-x", ms.round_x_decimals || 0);
    setV("map-snap-y", ms.round_y_decimals || 0);
    setV("map-snap-mode", ms.snap_mode || "Round");
    $$('input[name="map-tv"]').forEach((r) => { r.checked = r.value === (ms.table_view || "2D"); });
  }

  function persistSettings() {
    window.LUMOS_config.update({
      map_settings: {
        interpolation_method: $("#map-interp").value,
        idw_smoothing: Number($("#map-idw").value) || 0,
        colormap: $("#map-cmap").value,
        show_contour_lines: $("#map-contour").checked,
        manual_minmax: $("#map-manual-mm").checked,
        hide_ticks: $("#map-hide-ticks").checked,
        swap_xy: $("#map-swap").checked,
        tick_font: $("#map-tick-font").value,
        tick_font_size: Number($("#map-tick-size").value) || 11,
        tick_bold: $("#map-tick-bold").checked,
        frame_line_width: Number($("#map-frame-lw").value) || 1,
        legend_style: ($$('input[name="map-legend"]').find((r) => r.checked) || {}).value || "bar",
        legend_font: $("#map-legend-font").value,
        legend_font_size: Number($("#map-legend-size").value) || 10,
        legend_bold: $("#map-legend-bold").checked,
        plot_size: Number($("#map-size").value) || 100,
        map_columns: Number($("#map-cols").value) || 2,
        value_show: $("#map-values").checked,
        value_fontsize: Number($("#map-value-size").value) || 9,
        value_color: $("#map-value-color").value,
        value_bold: $("#map-value-bold").checked,
        value_auto_inward: $("#map-value-inward").checked,
        value_decimals: decimals(),
        point_show: $("#map-point-show").checked,
        point_size: Number($("#map-point-size").value),
        point_fill: $("#map-point-fill").value,
        point_outline: $("#map-point-outline").checked,
        point_outline_color: $("#map-point-outline-color").value,
        snap_coords_enabled: $("#map-snap-enable").checked,
        snap_mode: $("#map-snap-mode").value,
        round_x_decimals: Number($("#map-snap-x").value) || 0,
        round_y_decimals: Number($("#map-snap-y").value) || 0,
        table_view: ($$('input[name="map-tv"]').find((r) => r.checked) || {}).value || "2D",
      },
    });
  }

  // ---------- data ----------

  const MAX_INPUT_CHARS = 25_000_000;   // memory-safety cap
  const SUMMARIZE_CHARS = 100_000;      // above this, show a summary instead of the raw text
  let _summaryText = null;
  let _pasteViaKey = 0;
  const LOG = (m, x) => { if (window.LUMOS_log) window.LUMOS_log.log(m, x); };
  const canReadClip = () => !!(navigator.clipboard && navigator.clipboard.readText);
  function onPasteKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "v" || e.key === "V") && canReadClip()) {
      e.preventDefault();
      _pasteViaKey = Date.now();
      loadFromClipboard();
    }
  }

  function summarizeInput(text, nMaps, nPoints) {
    const ta = $("#map-input");
    if (text.length <= SUMMARIZE_CHARS) { _summaryText = null; ta.value = text; return; }
    const ko = window.LUMOS_i18n && window.LUMOS_i18n.lang && window.LUMOS_i18n.lang() === "ko";
    _summaryText = ko
      ? `✓ 맵 ${nMaps}개, 점 ${nPoints}개 불러옴.\n(응답성 유지를 위해 붙여넣은 데이터는 숨겼습니다 — 다시 붙여넣으면 교체됩니다.)`
      : `✓ Loaded ${nMaps} map(s), ${nPoints} points.\n(Pasted data hidden to stay responsive — paste again to replace.)`;
    ta.value = _summaryText;
  }

  // text/plain only — avoids the Ctrl+V paste event materialising Excel's huge
  // hidden HTML copy (which can OOM the renderer's native memory).
  function loadFromClipboard() {
    LOG("map clip:click");
    U.readClipboardText().then((t) => {
      LOG("map clip:read", { chars: t ? t.length : 0 });
      if (!t) { setStatus("Clipboard has no text (or permission denied).", "warn"); return; }
      if (t.length > MAX_INPUT_CHARS) { setStatus(`Too large to load safely (${(t.length / 1e6).toFixed(1)}M chars). Select only the data range in Excel.`, "error"); return; }
      U.runWithBusy($("#map-busy"), () => doLoad(t));
    }).catch(() => setStatus("Clipboard read blocked (needs HTTPS / permission).", "warn"));
  }

  function onInputPaste(e) {
    if (Date.now() - _pasteViaKey < 800) return;  // already handled at keydown
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) { setTimeout(loadFromTextarea, 0); return; }
    const text = cd.getData("text");
    if (!text) return;
    e.preventDefault();
    LOG("map paste", { chars: text.length });
    if (text.length > MAX_INPUT_CHARS) {
      setStatus(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars — likely a whole-column copy). Trim the selection.`, "error");
      return;
    }
    U.runWithBusy($("#map-busy"), () => doLoad(text));
  }

  function loadFromTextarea() {
    const text = $("#map-input").value;
    if (!text.trim()) return;
    if (_summaryText && text === _summaryText) return;
    U.runWithBusy($("#map-busy"), () => doLoad(text));
  }

  function doLoad(text) {
    LOG("map doLoad start", { chars: text.length });
    try {
      if (text.length > MAX_INPUT_CHARS) {
        throw new Error(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars). Trim the data.`);
      }
      const est = P.estimateCells(text);
      LOG("map preflight", est);
      if (est.cells > 3_000_000) {
        throw new Error(`Too large (~${est.rows}×${est.cols} ≈ ${(est.cells / 1e6).toFixed(1)}M cells).`);
      }
      _state = null; _interpCache.clear();
      const parsed = P.parseMapDataMulti(text);
      _state = { zNames: parsed.zNames, rawByZ: parsed.rawByZ, pivots: [] };
      _tableZ = 0;
      const total = parsed.rawByZ.reduce((s, t) => s + t.length, 0);
      LOG("map parsed", { maps: parsed.zNames.length, points: total });
      applySnapAndRender();
      LOG("map render done");
      summarizeInput(text, parsed.zNames.length, total);
      setStatus(`Loaded ${parsed.zNames.length} map(s), ${total} points.`);
    } catch (e) {
      LOG("map doLoad ERROR", String(e && e.message || e));
      setStatus(String(e.message || e), "error");
    }
  }

  function reset() {
    _state = null;
    _summaryText = null;
    _interpCache.clear();
    $("#map-input").value = "";
    $("#map-table-host").innerHTML = "";
    $("#map-ztabs").innerHTML = "";
    $("#map-plots").innerHTML = "";
    $("#map-info").textContent = "";
    setStatus("Map cleared.");
  }

  function applySnapAndRender() {
    if (!_state) return;
    const on = $("#map-snap-enable").checked;
    const nx = Number($("#map-snap-x").value) || 0;
    const ny = Number($("#map-snap-y").value) || 0;
    const mode = $("#map-snap-mode").value;
    const snap = on && (nx !== 0 || ny !== 0);
    _state.pivots = _state.rawByZ.map((tr) => snap ? P.snapAndPivot(tr, nx, ny, mode) : P.pivotLong(tr));
    _pivotVersion++;          // source grid changed -> interpolation cache stale
    _interpCache.clear();
    render();
    _persist();
  }

  function orientedPivot(i) {
    if (!_state || !_state.pivots[i]) return null;
    const { xs, ys, Z } = _state.pivots[i];
    if ($("#map-swap").checked) {
      const Zt = xs.map((_, c) => Z.map((row) => row[c]));
      return { xs: ys, ys: xs, Z: Zt };
    }
    return { xs, ys, Z };
  }

  // ---------- rendering ----------

  function clearCanvas() {
    const host = $("#map-plots");
    if (host) host.innerHTML = "";
  }

  function safeName(s) { return String(s).replace(/[^\w.-]+/g, "_").slice(0, 40) || "map"; }

  function copyCanvas(canvas) {
    if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") { setStatus("Image clipboard copy isn't supported in this browser.", "warn"); return; }
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try { await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]); setStatus("Map copied to clipboard."); }
      catch (e) { setStatus("Copy failed (needs HTTPS / clipboard permission).", "error"); }
    }, "image/png");
  }

  function render() {
    if (!_state) return;
    if (activePane() === "table") { renderTable(); return; }
    renderMaps();
  }

  // One bordered cell per Z column, tiled on a grid (Columns control), each
  // with its own title, Copy / Save buttons and a compact stats line.
  function renderMaps() {
    const host = $("#map-plots");
    if (!host) return;
    host.innerHTML = "";
    const n = _state.zNames.length;
    const cols = Math.max(1, Math.min(Number($("#map-cols").value) || 2, n));
    host.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
    let infoParts = [];
    for (let i = 0; i < n; i++) {
      const data = orientedPivot(i);
      const cell = el("div", { class: "dp-plot-cell map-cell" });
      cell.appendChild(el("div", { class: "map-cell-title" }, _state.zNames[i]));
      const canvas = el("canvas", {});
      cell.appendChild(canvas);
      const copyBtn = el("button", {}, "Copy");
      copyBtn.addEventListener("click", () => copyCanvas(canvas));
      const saveBtn = el("button", {}, "Save");
      saveBtn.addEventListener("click", () => U.downloadCanvasPNG(canvas, `map_${safeName(_state.zNames[i])}.png`));
      cell.appendChild(el("div", { class: "dp-plot-tools" }, [copyBtn, saveBtn]));
      host.appendChild(cell);
      const info = drawMap(canvas, data, i);
      if (info && i === 0) infoParts.push(info);
    }
    $("#map-info").textContent = `${n} map(s)` + (infoParts[0] ? ` • ${infoParts[0]}` : "");
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const STAT_ROWS = [["avg", "mean"], ["max", "max"], ["min", "min"], ["range", "range"], ["std", "std"], ["unif (%)", "unif"]];

  // Per-Z statistics over the finite pivot values (orientation-independent).
  function mapStatsByZ() {
    return _state.pivots.map((p) => {
      const flat = [];
      for (const row of p.Z) for (const v of row) if (Number.isFinite(v)) flat.push(v);
      return N.stats(flat);
    });
  }

  // Merge all Z pivots into long rows keyed by (x, y): { x, y, z:[z1,z2,…] }.
  function mergedLongTable() {
    const n = _state.zNames.length;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const { xs, ys, Z } = orientedPivot(i);
      for (let r = 0; r < ys.length; r++) {
        for (let c = 0; c < xs.length; c++) {
          const v = Z[r][c];
          if (!Number.isFinite(v)) continue;
          const x = xs[c], y = ys[r], key = x + "|" + y;
          let row = map.get(key);
          if (!row) { row = { x, y, z: new Array(n).fill(NaN) }; map.set(key, row); }
          row.z[i] = v;
        }
      }
    }
    const rows = Array.from(map.values());
    rows.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    return rows;
  }

  function renderTable() {
    if (!_state) return;
    const view = ($$('input[name="map-tv"]').find((r) => r.checked) || {}).value || "2D";
    const host = $("#map-table-host");
    const ztabs = $("#map-ztabs");
    if (!host) return;
    host.innerHTML = "";
    const n = _state.zNames.length;
    const table = el("table", { class: "data-table" });
    const thead = el("thead");
    const tbody = el("tbody");
    table.append(thead, tbody);

    if (view === "2D") {
      // One tab per Z; each tab shows that Z's 2D pivot.
      ztabs.style.display = n > 1 ? "" : "none";
      ztabs.innerHTML = "";
      if (n > 1) {
        _state.zNames.forEach((zn, i) => {
          const li = el("li", { class: i === _tableZ ? "active" : "" }, zn);
          li.addEventListener("click", () => { _tableZ = i; renderTable(); });
          ztabs.appendChild(li);
        });
      }
      const zi = Math.min(_tableZ, n - 1);
      const { xs, ys, Z } = orientedPivot(zi);
      const hr = el("tr");
      hr.appendChild(el("th"));
      xs.forEach((x) => hr.appendChild(el("th", {}, U.fmt(x, 6))));
      thead.appendChild(hr);
      const yOrder = ys.map((_, i) => i).sort((a, b) => ys[b] - ys[a]);
      yOrder.forEach((ri) => {
        const tr = el("tr");
        tr.appendChild(el("th", {}, U.fmt(ys[ri], 6)));
        xs.forEach((_, c) => {
          const v = Z[ri][c];
          tr.appendChild(el("td", {}, Number.isFinite(v) ? U.fmt(v, 6) : ""));
        });
        tbody.appendChild(tr);
      });
    } else if (view === "Stats") {
      // One column per Z, one row per statistic.
      ztabs.style.display = "none";
      const stats = mapStatsByZ();
      const hr = el("tr");
      hr.appendChild(el("th", {}, ""));
      _state.zNames.forEach((zn) => hr.appendChild(el("th", {}, zn)));
      thead.appendChild(hr);
      for (const [label, key] of STAT_ROWS) {
        const tr = el("tr");
        tr.appendChild(el("th", {}, label));
        stats.forEach((s) => { const v = s[key]; tr.appendChild(el("td", {}, Number.isFinite(v) ? U.fmt(v, 6) : "—")); });
        tbody.appendChild(tr);
      }
    } else {
      // 3-Col: X, Y, z1, z2, … (all Z as columns).
      ztabs.style.display = "none";
      const hr = el("tr");
      ["X", "Y"].concat(_state.zNames).forEach((h) => hr.appendChild(el("th", {}, h)));
      thead.appendChild(hr);
      for (const row of mergedLongTable()) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, U.fmt(row.x, 6)));
        tr.appendChild(el("td", {}, U.fmt(row.y, 6)));
        for (let i = 0; i < n; i++) tr.appendChild(el("td", {}, Number.isFinite(row.z[i]) ? U.fmt(row.z[i], 6) : ""));
        tbody.appendChild(tr);
      }
    }
    host.appendChild(table);
  }

  function drawLegendBar(ctx, rect, cmap, zMin, zMax, font, size, bold, d) {
    const { x, y, w, h } = rect;
    for (let py = 0; py < h; py++) {
      const t = 1 - py / ((h - 1) || 1);
      const [r, g, b] = PL.cmapLookup(cmap, t);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y + py, w, 1);
    }
    ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = "#222"; ctx.font = `${bold ? "bold " : ""}${size}px ${font}`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    const ticks = PL.makeTicks(zMin, zMax, 5);
    for (const tv of ticks) {
      const t = (tv - zMin) / ((zMax - zMin) || 1);
      const ty = y + h - t * h;
      ctx.beginPath(); ctx.moveTo(x + w, ty); ctx.lineTo(x + w + 3, ty); ctx.stroke();
      ctx.fillText(fmtN(tv, d), x + w + 6, ty);
    }
  }

  // Compact Minitab-style key: small colour squares stacked at the top-right of
  // the map, each labelled with its value range (highest band on top).
  function drawLegendSplit(ctx, x, y, cmap, zMin, zMax, nBands, font, size, bold, d) {
    const sq = Math.max(12, size + 4);
    const gap = 4;
    ctx.font = `${bold ? "bold " : ""}${size}px ${font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let i = 0; i < nBands; i++) {
      const tTop = (nBands - i) / nBands;
      const tBot = (nBands - i - 1) / nBands;
      const [r, g, b] = PL.cmapLookup(cmap, (tTop + tBot) / 2);
      const by = y + i * (sq + gap);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, by, sq, sq);
      ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, by + 0.5, sq, sq);
      const vTop = zMin + tTop * (zMax - zMin);
      const vBot = zMin + tBot * (zMax - zMin);
      ctx.fillStyle = "#222";
      ctx.fillText(`${fmtN(vBot, d)} – ${fmtN(vTop, d)}`, x + sq + 6, by + sq / 2);
    }
  }

  // Expensive bit (RBF/IDW over the grid) — cached so display-only changes
  // (colormap, legend, size, value labels, ticks…) just redraw and don't
  // re-interpolate. Recomputes only when the data, swap, method or smoothing
  // changes.
  function ensureInterp(data, zIndex) {
    const { xs, ys, Z } = data;
    const swap = $("#map-swap").checked ? 1 : 0;
    let method = $("#map-interp").value;
    const idw = Number($("#map-idw").value) || 0;
    const key = `${_pivotVersion}|${zIndex}|${swap}|${method}|${idw}`;
    const cached = _interpCache.get(key);
    if (cached) return cached;

    const xk = [], yk = [], zk = [];
    for (let r = 0; r < ys.length; r++) {
      for (let c = 0; c < xs.length; c++) {
        const v = Z[r][c];
        if (Number.isFinite(v)) { xk.push(xs[c]); yk.push(ys[r]); zk.push(v); }
      }
    }
    if (xk.length < 3) { setStatus("Need at least 3 valid points to interpolate.", "warn"); return null; }

    const cfg = window.LUMOS_config.load();
    const gridMax = cfg.map_rbf_grid_resolution || 150;
    const rbfMax = cfg.map_rbf_max_points || 200;
    if (method.startsWith("rbf_") && xk.length > rbfMax) {
      setStatus(`Auto-fallback: ${xk.length} points > ${rbfMax}, using IDW.`, "warn");
      method = "idw";
    }
    const gridN = Math.max(40, Math.min(gridMax, Math.round(20 * Math.sqrt(xk.length))));
    const xMin = arrMin(xs), xMax = arrMax(xs);
    const yMin = arrMin(ys), yMax = arrMax(ys);
    const xi = N.linspace(xMin, xMax, gridN);
    const yi = N.linspace(yMin, yMax, gridN);

    const nowFn = (window.performance && window.performance.now) ? window.performance.now.bind(window.performance) : null;
    const t0 = nowFn ? nowFn() : 0;
    let ZI;
    try {
      if (method.startsWith("rbf_")) {
        const fit = N.rbfFit(xk, yk, zk, method.replace("rbf_", ""));
        ZI = yi.map((yy) => xi.map((xx) => fit(xx, yy)));
      } else {
        ZI = N.idwGrid(xk, yk, zk, xi, yi, 2.0, idw);
      }
    } catch (e) {
      setStatus("Interpolation failed: " + e.message, "error"); return null;
    }
    const ms = nowFn ? Math.round(nowFn() - t0) : 0;
    const interp = { key, xi, yi, ZI, xMin, xMax, yMin, yMax, xk, yk, zk, gridN, method, ms };
    _interpCache.set(key, interp);
    return interp;
  }

  const MAP_BASE = 800;  // px: max map-box side at 100% size

  // Draw one Z map into its own canvas, sized tightly to the map + legend.
  // Returns a short info string (points / grid / method / time).
  function drawMap(canvas, data, zIndex) {
    if (!data) return "";
    const I = ensureInterp(data, zIndex);
    if (!I) { canvas.width = 1; canvas.height = 1; return ""; }
    const { xi, yi, ZI, xMin, xMax, yMin, yMax, xk, yk, zk, gridN, method, ms } = I;

    let zMin, zMax;
    if ($("#map-manual-mm").checked) {
      const vmin = Number($("#map-vmin").value), vmax = Number($("#map-vmax").value);
      zMin = Number.isFinite(vmin) ? vmin : arrMin(zk);
      zMax = Number.isFinite(vmax) ? vmax : arrMax(zk);
    } else {
      zMin = arrMin(zk); zMax = arrMax(zk);
    }
    if (zMin === zMax) zMax = zMin + 1;

    const cmap = $("#map-cmap").value;
    const legendStyle = ($$('input[name="map-legend"]').find((r) => r.checked) || {}).value || "bar";
    const tickFont = $("#map-tick-font").value;
    const tickSize = Number($("#map-tick-size").value) || 11;
    const tickBold = $("#map-tick-bold").checked;
    const frameLW = Number($("#map-frame-lw").value) || 1;
    const legFont = $("#map-legend-font").value;
    const legSize = Number($("#map-legend-size").value) || 10;
    const legBold = $("#map-legend-bold").checked;
    const hideTicks = $("#map-hide-ticks").checked;
    const sizeFrac = (Number($("#map-size").value) || 100) / 100;

    const padLeft = hideTicks ? 14 : Math.max(48, Math.round(tickSize * 4));
    const padTop = 14;
    const padBottom = hideTicks ? 14 : tickSize + 24;
    const barW = 16;   // thin colour bar
    const dec = decimals();
    // Measure widest legend label so the canvas is sized to fit it exactly.
    const legendSwatch = legendStyle === "split" ? Math.max(12, legSize + 4) : barW;
    let maxLabelW = 0;
    const mctx = canvas.getContext("2d");
    if (legendStyle !== "off") {
      mctx.font = `${legBold ? "bold " : ""}${legSize}px ${legFont}`;
      if (legendStyle === "split") {
        const nB = PL.cmapBands(cmap) || 7;
        for (let i = 0; i < nB; i++) {
          const tTop = (nB - i) / nB, tBot = (nB - i - 1) / nB;
          const vTop = zMin + tTop * (zMax - zMin), vBot = zMin + tBot * (zMax - zMin);
          maxLabelW = Math.max(maxLabelW, mctx.measureText(`${fmtN(vBot, dec)} – ${fmtN(vTop, dec)}`).width);
        }
      } else {
        for (const tv of PL.makeTicks(zMin, zMax, 5)) {
          maxLabelW = Math.max(maxLabelW, mctx.measureText(fmtN(tv, dec)).width);
        }
      }
    }
    const padRight = legendStyle === "off" ? 14 : (12 + legendSwatch + 6 + Math.ceil(maxLabelW) + 10);

    // Box fits the data aspect within a base square scaled by size%.
    const maxBox = Math.max(40, Math.round(MAP_BASE * sizeFrac));
    const dataAspect = ((xMax - xMin) || 1) / ((yMax - yMin) || 1);
    let bw, bh;
    if (dataAspect >= 1) { bw = maxBox; bh = maxBox / dataAspect; }
    else { bh = maxBox; bw = maxBox * dataAspect; }
    bw = Math.max(20, bw); bh = Math.max(20, bh);

    const box = { x: padLeft, y: padTop, w: bw, h: bh };
    // Canvas sized tightly to the content (map + legend), so per-cell copy/save
    // captures just the map.
    let w = padLeft + bw + padRight;
    let h = padTop + bh + padBottom;
    if (legendStyle === "split") {
      const sq = Math.max(12, legSize + 4);
      h = Math.max(h, padTop + (PL.cmapBands(cmap) || 7) * (sq + 4) + 4);
    }
    const rect = { x: 0, y: 0, w, h };
    const ctx = PL.fitCanvas(canvas, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    const T = PL.makeTransform(box, [xMin, xMax], [yMin, yMax]);

    // Heatmap first, then the no-fill axes frame + ticks on top (so the
    // colormap fill stays visible).
    PL.drawHeatmap(ctx, box, xi, yi, ZI, { cmap, zMin, zMax });
    PL.drawAxes(ctx, rect, {
      box, transform: T, xRange: [xMin, xMax], yRange: [yMin, yMax],
      fill: false, hideTicks,
      tickFont, tickFontSize: tickSize, tickBold, frameLineWidth: frameLW,
    });

    if ($("#map-contour").checked) {
      const bands = PL.cmapBands(cmap);
      const nLevels = bands ? bands + 1 : 11;
      const levels = N.linspace(zMin, zMax, nLevels);
      for (const lv of levels) {
        PL.drawContourLines(ctx, T, PL.isoContour(xi, yi, ZI, lv), "rgba(0,0,0,0.55)", 0.6);
      }
    }

    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    if ($("#map-point-show").checked) {
      const ptSize = Number($("#map-point-size").value);
      const ptSizeOk = Number.isFinite(ptSize) ? ptSize : 3;
      PL.drawScatter(ctx, T, xk, yk, {
        fillColor: $("#map-point-fill").value || "#111111",
        strokeColor: $("#map-point-outline").checked ? ($("#map-point-outline-color").value || "#ffffff") : null,
        strokeWidth: 1,
        markerSize: ptSizeOk,
      });
    }
    if ($("#map-values").checked) drawValueLabels(ctx, T, box, xk, yk, zk);
    ctx.restore();

    if (legendStyle === "split") {
      drawLegendSplit(ctx, box.x + box.w + 12, box.y, cmap, zMin, zMax, PL.cmapBands(cmap) || 7, legFont, legSize, legBold, dec);
    } else if (legendStyle === "bar") {
      drawLegendBar(ctx, { x: box.x + box.w + 12, y: box.y, w: barW, h: box.h }, cmap, zMin, zMax, legFont, legSize, legBold, dec);
    }

    return `Points: ${xk.length} • Grid: ${gridN}² • ${method} • ${ms}ms`;
  }

  function drawValueLabels(ctx, T, box, xk, yk, zk) {
    const size = Number($("#map-value-size").value) || 9;
    const color = $("#map-value-color").value || "#ffffff";
    const bold = $("#map-value-bold").checked;
    const inward = $("#map-value-inward").checked;
    const [xMin, xMax] = T.xRange, [yMin, yMax] = T.yRange;
    const base = size + 2;
    const d = decimals();
    ctx.font = `${bold ? "bold " : ""}${size}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < xk.length; i++) {
      const p = T.toPx(xk[i], yk[i]);
      let ox = 0, oy = -base;
      if (inward) {
        const rx = (xk[i] - xMin) / ((xMax - xMin) || 1);
        const ry = (yk[i] - yMin) / ((yMax - yMin) || 1);
        oy = ry > 0.85 ? base : -base;
        ox = rx > 0.85 ? -base : (rx < 0.15 ? base : 0);
      }
      const txt = fmtN(zk[i], d);
      const tx = p.x + ox, ty = p.y + oy;
      const tw = ctx.measureText(txt).width + 6;
      const th = size + 4;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      roundRect(ctx, tx - tw / 2, ty - th / 2, tw, th, 3);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(txt, tx, ty);
    }
  }

  function copyTable() {
    if (!_state) return;
    const view = ($$('input[name="map-tv"]').find((r) => r.checked) || {}).value || "2D";
    const n = _state.zNames.length;
    let lines;
    if (view === "2D") {
      const { xs, ys, Z } = orientedPivot(Math.min(_tableZ, n - 1));
      lines = ["\t" + xs.map((x) => U.fmt(x, 6)).join("\t")];
      for (let r = ys.length - 1; r >= 0; r--) {
        const row = [U.fmt(ys[r], 6)];
        for (let c = 0; c < xs.length; c++) row.push(Number.isFinite(Z[r][c]) ? U.fmt(Z[r][c], 6) : "");
        lines.push(row.join("\t"));
      }
    } else if (view === "Stats") {
      const stats = mapStatsByZ();
      lines = [[""].concat(_state.zNames).join("\t")];
      for (const [label, key] of STAT_ROWS) {
        const cells = [label];
        stats.forEach((s) => { const v = s[key]; cells.push(Number.isFinite(v) ? U.fmt(v, 6) : ""); });
        lines.push(cells.join("\t"));
      }
    } else {
      lines = [["X", "Y"].concat(_state.zNames).join("\t")];
      for (const row of mergedLongTable()) {
        const cells = [U.fmt(row.x, 6), U.fmt(row.y, 6)];
        for (let i = 0; i < n; i++) cells.push(Number.isFinite(row.z[i]) ? U.fmt(row.z[i], 6) : "");
        lines.push(cells.join("\t"));
      }
    }
    U.copyToClipboard(lines.join("\n")).then((ok) => setStatus(ok ? "Table copied." : "Copy failed.", ok ? "" : "warn"));
  }

  // ---------- events ----------

  function onDocPaste(e) {
    const tab = $("section.tab-panel.active");
    if (!tab || tab.dataset.tab !== "map") return;
    if (e.target && e.target.id === "map-input") return;
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData("text") : "";
    if (!text) return;
    e.preventDefault();
    U.runWithBusy($("#map-busy"), () => doLoad(text));
  }

  const RENDER_IDS = [
    "map-interp", "map-idw", "map-cmap", "map-contour",
    "map-manual-mm", "map-vmin", "map-vmax",
    "map-hide-ticks", "map-swap", "map-tick-font", "map-tick-size", "map-tick-bold", "map-frame-lw",
    "map-legend-font", "map-legend-size", "map-legend-bold", "map-size", "map-cols",
    "map-values", "map-value-size", "map-value-color", "map-value-bold", "map-value-inward", "map-decimals",
    "map-point-show", "map-point-size", "map-point-fill", "map-point-outline", "map-point-outline-color",
  ];
  const SNAP_IDS = ["map-snap-enable", "map-snap-x", "map-snap-y", "map-snap-mode"];

  function bindEvents() {
    $("#map-load").addEventListener("click", loadFromTextarea);
    $("#map-clip").addEventListener("click", loadFromClipboard);
    $("#map-reset").addEventListener("click", reset);
    $("#map-input").addEventListener("paste", onInputPaste);
    $("#map-copy-table").addEventListener("click", copyTable);

    $$("#map-tabs li").forEach((li) => li.addEventListener("click", () => showPane(li.getAttribute("data-pane"))));

    const onRender = () => { if (_state) render(); _persist(); };
    RENDER_IDS.forEach((id) => {
      const e = $("#" + id);
      if (!e) return;
      e.addEventListener("change", onRender);
      e.addEventListener("input", onRender);
    });
    $$('input[name="map-legend"]').forEach((r) => r.addEventListener("change", onRender));
    SNAP_IDS.forEach((id) => {
      const e = $("#" + id);
      if (!e) return;
      e.addEventListener("change", applySnapAndRender);
      e.addEventListener("input", applySnapAndRender);
    });
    $$('input[name="map-tv"]').forEach((r) => r.addEventListener("change", () => { renderTable(); _persist(); }));

    document.addEventListener("paste", onDocPaste);
  }

  // ---------- lifecycle ----------

  function init(root) {
    buildUI(root);
    _persist = U.debounce(persistSettings, 300);
    restoreSettings();
    bindEvents();
    window.addEventListener("resize", U.debounce(() => { if (_state && activePane() === "map") render(); }, 150));
  }

  function onShow() { if (_state && activePane() === "map") window.requestAnimationFrame(render); }
  function onSettingsChanged() { if (_state) render(); }

  window.LUMOS_tab_map = { init, onShow, onSettingsChanged, loadFromClipboard };
})();

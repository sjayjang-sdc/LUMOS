// Data Plot tab — port of LUMOS_plot.py (DPlotWindow). Laid out as a
// 3-column master-detail inside the tab:
//   [section nav] [active section, partitioned into blocks] [per-plot canvases]
// Sections: Data, Columns, Mode (X/Y handling + Reference split + Filter),
// Style (Series + Axes & font + Legend + Layout).
"use strict";

(function () {
  const U = window.LUMOS_util;
  const { el, $, $$, setStatus } = U;
  const P = window.LUMOS_parse;
  const PL = window.LUMOS_plotting;

  const FONTS = ["system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "monospace"];
  const LEGEND_LOCS = ["best", "upper right", "upper left", "lower right", "lower left"];

  // _state: { headers:[name], nrows, col:{name:{raw:[],num:[],isPercent}} }
  let _state = null;
  let _sel = { x: new Set(), y: new Set(), colorRef: new Set() };
  let _sets = [];                  // Paired X/Y mode: [{ name, x: colName, y: colName }]
  let _filter = { col: null, included: [] };
  let _filterDraft = null;
  let _persist = null;
  let _drag = null;   // column-list drag-select state

  // ---------- small element helpers ----------

  function block(title, children) {
    return el("div", { class: "dp-block" }, [el("h4", {}, title)].concat(children));
  }
  function prefRow(label, input) {
    return el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, label), input]);
  }
  function selectEl(id, opts) {
    const s = el("select", { id });
    opts.forEach((o) => s.appendChild(el("option", { value: o }, o)));
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
  function chkEl(id, checked) {
    return el("input", checked ? { type: "checkbox", id, checked: true } : { type: "checkbox", id });
  }
  function colorEl(id, val) {
    return el("input", { type: "color", id, value: val });
  }
  function txtEl(id) {
    return el("input", { type: "text", id, placeholder: "auto" });
  }

  function parseFinite(s) {
    s = (s || "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  // ---------- UI construction ----------

  function buildUI(root) {
    root.innerHTML = "";
    const layout = el("div", { class: "dp-layout" });
    root.appendChild(layout);

    // Column 1: section nav
    const nav = el("ul", { class: "dp-nav", id: "dp-nav" });
    [["data", "Data"], ["columns", "Columns"], ["mode", "Mode"], ["style", "Style"]]
      .forEach(([id, label], i) => {
        const li = el("li", { "data-sec": id, class: i === 0 ? "active" : "" }, label);
        li.addEventListener("click", () => showSection(id));
        nav.appendChild(li);
      });
    layout.appendChild(nav);

    // Column 2: section panel
    const panel = el("div", { class: "dp-sections", id: "dp-sections" });
    layout.appendChild(panel);

    // --- Data ---
    panel.appendChild(el("div", { class: "dp-section active", "data-sec": "data" }, [
      el("div", { class: "hint" }, "Paste TSV/CSV. Header row recommended."),
      el("textarea", { id: "dp-input", rows: 9, placeholder: "X\tY1\tY2\n0\t1.0\t1.5\n1\t2.0\t2.5\n..." }),
      el("div", { class: "pref-hint", style: "margin:0 0 6px;" }, "For large Excel data use “Paste from clipboard” (Ctrl+V can choke on Excel’s hidden HTML copy)."),
      el("div", { class: "row" }, [
        el("button", { id: "dp-clip", class: "primary" }, "Paste from clipboard"),
        el("button", { id: "dp-load" }, "Load textarea"),
        el("button", { id: "dp-reset" }, "Reset"),
      ]),
    ]));

    // --- Columns (X/Y lists + X/Y handling) ---
    panel.appendChild(el("div", { class: "dp-section", "data-sec": "columns" }, [
      el("div", { id: "dp-xylist-wrap" }, [
        el("label", { class: "field-label" }, "X columns"),
        el("div", { id: "dp-xlist", class: "collist" }),
        el("label", { class: "field-label", style: "margin-top:8px;" }, "Y columns"),
        el("div", { id: "dp-ylist", class: "collist" }),
      ]),
      el("div", { id: "dp-sets-wrap", style: "display:none;" }, [
        el("label", { class: "field-label" }, "Sets"),
        el("div", { class: "row" }, [
          el("button", { id: "dp-sets-add" }, "+ Add set"),
        ]),
        el("div", { class: "pref-hint", style: "margin:4px 0 8px;" }, "Each set is one (X, Y) curve. Multiple sets overlay on one plot."),
        el("div", { id: "dp-sets-list" }),
      ]),
      block("X / Y handling", [
        el("label", { style: "display:block;" }, [el("input", { type: "radio", name: "dp-mode", id: "dp-mode-single", checked: true }), " Single-X (overlay / ref)"]),
        el("label", { style: "display:block;" }, [el("input", { type: "radio", name: "dp-mode", id: "dp-mode-multi" }), " Multiple X (subplots by X)"]),
        el("label", { style: "display:block;" }, [el("input", { type: "radio", name: "dp-mode", id: "dp-mode-pairs" }), " Paired X/Y (multi-set)"]),
        el("div", { id: "dp-single-opts", class: "subgroup" }, [
          el("label", {}, [el("input", { type: "radio", name: "dp-ymode", id: "dp-ymode-sub", checked: true }), " Subplots per Y"]),
          el("label", {}, [el("input", { type: "radio", name: "dp-ymode", id: "dp-ymode-ovl" }), " Overlay all Y"]),
        ]),
      ]),
    ]));

    // --- Mode (Reference split + Filter) ---
    panel.appendChild(el("div", { class: "dp-section", "data-sec": "mode" }, [
      el("div", { class: "dp-block", id: "dp-ref-block" }, [
        el("h4", {}, "Reference split"),
        el("div", { id: "dp-ref-reason", class: "ref-reason hidden" }),
        el("div", { id: "dp-ref-opts" }, [
          el("div", { id: "dp-plotref-row", class: "ref-row" }, [
            el("label", { style: "display:block;" }, [el("input", { type: "checkbox", id: "dp-plotref" }), " Plot Ref (split canvas)"]),
            el("select", { id: "dp-plotref-col", disabled: true }),
          ]),
          el("div", { id: "dp-colorref-row", class: "ref-row", style: "margin-top:6px;" }, [
            el("label", { style: "display:block;" }, [el("input", { type: "checkbox", id: "dp-colorref" }), " Color Ref (split color)"]),
            el("div", { id: "dp-colorref-list", class: "collist short disabled" }),
          ]),
        ]),
      ]),
      block("Filter", [
        el("div", { class: "row" }, [
          el("button", { id: "dp-filter-open" }, "Filter…"),
          el("label", {}, [el("input", { type: "checkbox", id: "dp-ghost" }), " Show ghost"]),
        ]),
        el("div", { id: "dp-filter-status", class: "hint" }, "No filter."),
      ]),
    ]));

    // --- Style (Series + Axes & font + Legend + Layout) ---
    panel.appendChild(el("div", { class: "dp-section", "data-sec": "style" }, [
      block("Series", [
        prefRow("Marker style", selectEl("dp-style", ["line", "markers", "both"])),
        prefRow("Line width", numEl("dp-lw", 1.6, { step: 0.1, min: 0.2 })),
        prefRow("Marker size", numEl("dp-ms", 3, { step: 0.5, min: 1 })),
        prefRow("Marker fill", selectEl("dp-marker-fill", ["filled", "hollow"])),
        prefRow("Outline (filled)", chkEl("dp-marker-outline")),
        prefRow("Outline color", colorEl("dp-marker-outline-color", "#000000")),
        el("div", { class: "pref-hint" }, "Hollow outline follows the series color; filled outline uses the color above."),
      ]),
      block("Axis", [
        prefRow("X title", txtEl("dp-xtitle")),
        prefRow("Y title", txtEl("dp-ytitle")),
        el("div", { class: "pref-hint" }, "Override the auto axis title for all subplots (empty = auto; common prefix is used when columns differ)."),
        prefRow("Log X", chkEl("dp-logx")),
        prefRow("Log Y", chkEl("dp-logy")),
        prefRow("X min", txtEl("dp-xmin")),
        prefRow("X max", txtEl("dp-xmax")),
        prefRow("Y min", txtEl("dp-ymin")),
        prefRow("Y max", txtEl("dp-ymax")),
        el("div", { class: "pref-hint" }, "Limits empty = auto. Data units (log axes accept the raw value)."),
      ]),
      block("Axes & font", [
        prefRow("Tick font", selectEl("dp-tick-font", FONTS)),
        prefRow("Tick size", numEl("dp-tick-size", 11, { min: 6, max: 48 })),
        prefRow("Tick bold", chkEl("dp-tick-bold")),
        prefRow("Tick italic", chkEl("dp-tick-italic")),
        prefRow("Title font", selectEl("dp-title-font", FONTS)),
        prefRow("Title size", numEl("dp-title-size", 12, { min: 6, max: 48 })),
        prefRow("Title bold", chkEl("dp-title-bold")),
        prefRow("Title italic", chkEl("dp-title-italic")),
        prefRow("Frame line width", numEl("dp-frame-lw", 1, { step: 0.5, min: 0.5 })),
        prefRow("Tick line width", numEl("dp-tick-lw", 1, { step: 0.5, min: 0.5 })),
        prefRow("Grid", chkEl("dp-grid", true)),
      ]),
      block("Legend", [
        prefRow("Show legend", chkEl("dp-legend", true)),
        prefRow("Position", selectEl("dp-legend-loc", LEGEND_LOCS)),
        prefRow("Legend font", selectEl("dp-legend-font", FONTS)),
        prefRow("Legend size", numEl("dp-legend-size", 11, { min: 6, max: 48 })),
        prefRow("Legend bold", chkEl("dp-legend-bold")),
        prefRow("Legend italic", chkEl("dp-legend-italic")),
      ]),
      block("Layout", [
        prefRow("Grid columns", numEl("dp-cols", 2, { min: 1, max: 10 })),
        prefRow("Subplot width", numEl("dp-subw", 500, { min: 100, max: 4000 })),
        prefRow("Subplot height", numEl("dp-subh", 400, { min: 100, max: 4000 })),
      ]),
    ]));

    // Column 3: actions + per-plot canvases
    const canvasCol = el("div", { class: "dp-canvas-col" });
    canvasCol.appendChild(el("div", { class: "dp-actions" }, [
      el("span", { class: "hint" }, "Plots update automatically. Each plot has its own Copy button (top-right)."),
    ]));
    canvasCol.appendChild(el("div", { class: "plot-area", id: "dp-plot-area" }, [
      el("div", { id: "dp-plots" }),
      U.busyOverlay("dp-busy"),
    ]));
    layout.appendChild(canvasCol);

    root.appendChild(buildFilterModal());
  }

  function buildFilterModal() {
    return el("div", { class: "modal hidden", id: "dp-filter-modal" }, [
      el("div", { class: "modal-content" }, [
        el("h2", {}, "Filter data"),
        el("label", { class: "field-label" }, "Filter column"),
        el("select", { id: "dp-filter-col" }),
        el("div", { class: "hint" }, "Included = plotted normally. Excluded = ghost (faint, shown when 'Show ghost' is on). Click a value to move it between sides."),
        el("div", { class: "filter-dual" }, [
          el("div", { class: "filter-side" }, [
            el("h4", {}, "Excluded (ghost)"),
            el("div", { id: "dp-filter-excl", class: "collist" }),
          ]),
          el("div", { class: "filter-mid" }, [
            el("button", { id: "dp-filter-allin" }, "all ⟶"),
            el("button", { id: "dp-filter-allout" }, "⟵ all"),
          ]),
          el("div", { class: "filter-side" }, [
            el("h4", {}, "Included (target)"),
            el("div", { id: "dp-filter-incl", class: "collist" }),
          ]),
        ]),
        el("div", { class: "modal-buttons" }, [
          el("button", { id: "dp-filter-clear" }, "Clear filter"),
          el("button", { id: "dp-filter-cancel" }, "Cancel"),
          el("button", { id: "dp-filter-apply", class: "primary" }, "Apply"),
        ]),
      ]),
    ]);
  }

  function showSection(id) {
    $$("#dp-nav li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-sec") === id));
    $$("#dp-sections .dp-section").forEach((s) => s.classList.toggle("active", s.getAttribute("data-sec") === id));
  }

  // ---------- Display settings (Style section) ----------

  function initDisplayControls() {
    const cfg = window.LUMOS_config.load();
    const ps = cfg.plot_settings || {};
    const setV = (id, v) => { const e = $("#" + id); if (e != null && v != null) e.value = v; };
    const setC = (id, v) => { const e = $("#" + id); if (e) e.checked = !!v; };
    setV("dp-style", ps.style || "both");
    setV("dp-lw", ps.line_width != null ? ps.line_width : 1.6);
    setV("dp-ms", ps.marker_size != null ? ps.marker_size : 3);
    setV("dp-marker-fill", ps.marker_fill || "filled");
    setC("dp-marker-outline", ps.marker_outline);
    setV("dp-marker-outline-color", ps.marker_outline_color || "#000000");
    setV("dp-xmin", ps.xlim_min || "");
    setV("dp-xmax", ps.xlim_max || "");
    setV("dp-ymin", ps.ylim_min || "");
    setV("dp-ymax", ps.ylim_max || "");
    setV("dp-xtitle", ps.x_title || "");
    setV("dp-ytitle", ps.y_title || "");
    setC("dp-logx", ps.log_x);
    setC("dp-logy", ps.log_y);
    setC("dp-grid", ps.show_grid !== false);
    setV("dp-tick-font", ps.tick_font || "system-ui");
    setV("dp-tick-size", ps.tick_font_size != null ? ps.tick_font_size : 11);
    setC("dp-tick-bold", ps.tick_bold);
    setC("dp-tick-italic", ps.tick_italic);
    setV("dp-title-font", ps.title_font || "system-ui");
    setV("dp-title-size", ps.title_font_size != null ? ps.title_font_size : 12);
    setC("dp-title-bold", ps.title_bold);
    setC("dp-title-italic", ps.title_italic);
    setV("dp-frame-lw", ps.frame_line_width != null ? ps.frame_line_width : 1);
    setV("dp-tick-lw", ps.tick_line_width != null ? ps.tick_line_width : 1);
    setC("dp-legend", ps.show_legend !== false);
    setV("dp-legend-loc", ps.legend_loc || "upper right");
    setV("dp-legend-font", ps.legend_font || "system-ui");
    setV("dp-legend-size", ps.legend_font_size != null ? ps.legend_font_size : 11);
    setC("dp-legend-bold", ps.legend_bold);
    setC("dp-legend-italic", ps.legend_italic);
    setV("dp-cols", cfg.plot_columns != null ? cfg.plot_columns : 2);
    setV("dp-subw", (cfg.subplot_size && cfg.subplot_size[0]) || 500);
    setV("dp-subh", (cfg.subplot_size && cfg.subplot_size[1]) || 400);
  }

  function getDisplayOpts() {
    const style = $("#dp-style").value;
    return {
      logX: $("#dp-logx").checked,
      logY: $("#dp-logy").checked,
      showLines: style === "line" || style === "both",
      showPoints: style === "markers" || style === "both",
      lw: Number($("#dp-lw").value) || 1.6,
      ms: Number($("#dp-ms").value) || 3,
      markerFill: $("#dp-marker-fill").value,
      markerOutline: $("#dp-marker-outline").checked,
      outlineColor: $("#dp-marker-outline-color").value || "#000000",
      xmin: parseFinite($("#dp-xmin").value),
      xmax: parseFinite($("#dp-xmax").value),
      ymin: parseFinite($("#dp-ymin").value),
      ymax: parseFinite($("#dp-ymax").value),
      xtitle: ($("#dp-xtitle").value || "").trim(),
      ytitle: ($("#dp-ytitle").value || "").trim(),
      showGrid: $("#dp-grid").checked,
      showLegend: $("#dp-legend").checked,
      legendLoc: $("#dp-legend-loc").value,
      legendFont: $("#dp-legend-font").value,
      legendFontSize: Number($("#dp-legend-size").value) || 11,
      legendBold: $("#dp-legend-bold").checked,
      legendItalic: $("#dp-legend-italic").checked,
      tickFont: $("#dp-tick-font").value,
      tickFontSize: Number($("#dp-tick-size").value) || 11,
      tickBold: $("#dp-tick-bold").checked,
      tickItalic: $("#dp-tick-italic").checked,
      titleFont: $("#dp-title-font").value,
      titleFontSize: Number($("#dp-title-size").value) || 12,
      titleBold: $("#dp-title-bold").checked,
      titleItalic: $("#dp-title-italic").checked,
      frameLineWidth: Number($("#dp-frame-lw").value) || 1,
      tickLineWidth: Number($("#dp-tick-lw").value) || 1,
    };
  }

  function persistDisplay() {
    window.LUMOS_config.update({
      plot_columns: Math.max(1, Number($("#dp-cols").value) || 2),
      subplot_size: [
        Math.max(100, Number($("#dp-subw").value) || 500),
        Math.max(100, Number($("#dp-subh").value) || 400),
      ],
      plot_settings: {
        style: $("#dp-style").value,
        line_width: Number($("#dp-lw").value) || 1.6,
        marker_size: Number($("#dp-ms").value) || 3,
        marker_fill: $("#dp-marker-fill").value,
        marker_outline: $("#dp-marker-outline").checked,
        marker_outline_color: $("#dp-marker-outline-color").value,
        xlim_min: $("#dp-xmin").value,
        xlim_max: $("#dp-xmax").value,
        ylim_min: $("#dp-ymin").value,
        ylim_max: $("#dp-ymax").value,
        x_title: $("#dp-xtitle").value,
        y_title: $("#dp-ytitle").value,
        log_x: $("#dp-logx").checked,
        log_y: $("#dp-logy").checked,
        show_grid: $("#dp-grid").checked,
        show_legend: $("#dp-legend").checked,
        legend_loc: $("#dp-legend-loc").value,
        legend_font: $("#dp-legend-font").value,
        legend_font_size: Number($("#dp-legend-size").value) || 11,
        legend_bold: $("#dp-legend-bold").checked,
        legend_italic: $("#dp-legend-italic").checked,
        tick_font: $("#dp-tick-font").value,
        tick_font_size: Number($("#dp-tick-size").value) || 11,
        tick_bold: $("#dp-tick-bold").checked,
        tick_italic: $("#dp-tick-italic").checked,
        title_font: $("#dp-title-font").value,
        title_font_size: Number($("#dp-title-size").value) || 12,
        title_bold: $("#dp-title-bold").checked,
        title_italic: $("#dp-title-italic").checked,
        frame_line_width: Number($("#dp-frame-lw").value) || 1,
        tick_line_width: Number($("#dp-tick-lw").value) || 1,
      },
    });
  }

  // Axis limits are data-dependent, so they reset on new/cleared data
  // (other display settings persist).
  function clearAxisLimits() {
    ["dp-xmin", "dp-xmax", "dp-ymin", "dp-ymax"].forEach((id) => {
      const e = $("#" + id);
      if (e) e.value = "";
    });
    if (_persist) _persist();
  }

  // ---------- Data loading ----------

  function dedupeHeaders(headers) {
    const seen = new Map();
    return headers.map((h) => {
      let name = (h && String(h).trim()) || "col";
      if (seen.has(name)) {
        const k = seen.get(name) + 1;
        seen.set(name, k);
        return `${name}_${k}`;
      }
      seen.set(name, 1);
      return name;
    });
  }

  const MAX_INPUT_CHARS = 25_000_000;   // memory-safety caps (avoid OOM crashes)
  const MAX_CELLS = 3_000_000;
  const SUMMARIZE_CHARS = 100_000;      // above this, show a summary instead of the raw text
  let _summaryText = null;              // current textarea summary (so re-load is a no-op)
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

  // Replace a huge pasted blob in the textarea with a short summary so the Data
  // section stays responsive (re-showing a multi-MB textarea re-lays-out and
  // freezes). The parsed data lives in memory; paste again to replace.
  function summarizeInput(text, nrows, ncols) {
    const ta = $("#dp-input");
    if (text.length <= SUMMARIZE_CHARS) { _summaryText = null; ta.value = text; return; }
    const ko = window.LUMOS_i18n && window.LUMOS_i18n.lang && window.LUMOS_i18n.lang() === "ko";
    _summaryText = ko
      ? `✓ ${nrows}행 × ${ncols}열 불러옴.\n(응답성 유지를 위해 붙여넣은 데이터는 숨겼습니다 — 다시 붙여넣으면 교체됩니다.)`
      : `✓ Loaded ${nrows} rows × ${ncols} columns.\n(Pasted data hidden to stay responsive — paste again to replace.)`;
    ta.value = _summaryText;
  }

  // text/plain only — avoids the Ctrl+V paste event materialising Excel's huge
  // hidden HTML copy (which can OOM the renderer's native memory).
  function loadFromClipboard() {
    LOG("dp clip:click");
    U.readClipboardText().then((t) => {
      LOG("dp clip:read", { chars: t ? t.length : 0 });
      if (!t) { setStatus("Clipboard has no text (or permission denied).", "warn"); return; }
      if (t.length > MAX_INPUT_CHARS) { setStatus(`Too large to load safely (${(t.length / 1e6).toFixed(1)}M chars). Select only the data range in Excel.`, "error"); return; }
      U.runWithBusy($("#dp-busy"), () => doLoad(t));
    }).catch(() => setStatus("Clipboard read blocked (needs HTTPS / permission).", "warn"));
  }

  function onInputPaste(e) {
    if (Date.now() - _pasteViaKey < 800) return;  // already handled at keydown
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) { setTimeout(loadFromTextarea, 0); return; }
    const text = cd.getData("text");
    if (!text) return;
    e.preventDefault();
    LOG("dp paste", { chars: text.length });
    if (text.length > MAX_INPUT_CHARS) {
      setStatus(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars — likely a whole-column copy). Trim the selection.`, "error");
      return;
    }
    U.runWithBusy($("#dp-busy"), () => doLoad(text));
  }

  function loadFromTextarea() {
    const text = $("#dp-input").value;
    if (!text.trim()) return;
    if (_summaryText && text === _summaryText) return;  // already loaded
    U.runWithBusy($("#dp-busy"), () => doLoad(text));
  }

  function doLoad(text) {
    LOG("dp doLoad start", { chars: text.length });
    try {
      if (text.length > MAX_INPUT_CHARS) {
        throw new Error(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars). Trim the data.`);
      }
      const est = P.estimateCells(text);
      LOG("dp preflight", est);
      if (est.cells > MAX_CELLS) {
        throw new Error(`Too large (~${est.rows}×${est.cols} ≈ ${(est.cells / 1e6).toFixed(1)}M cells); limit ${MAX_CELLS / 1e6}M.`);
      }
      _state = null;   // free previous dataset before allocating the new one
      const rows = P.parseTable(text);
      if (!rows.length) throw new Error("empty");
      let ncols0 = 0;
      for (let i = 0; i < rows.length; i++) if (rows[i].length > ncols0) ncols0 = rows[i].length;
      LOG("dp parsed", { rows: rows.length, cols: ncols0, cells: rows.length * ncols0 });
      if (rows.length * ncols0 > MAX_CELLS) {
        throw new Error(`Too many cells (${rows.length}×${ncols0}); limit ~${(MAX_CELLS / 1e6)}M to avoid running out of memory.`);
      }

      let headers, body;
      const firstAllNum = rows[0].every((c) => String(c).trim() !== "" && Number.isFinite(Number(c)));
      if (!firstAllNum) {
        headers = rows[0].map((c) => String(c).trim());
        body = rows.slice(1);
      } else {
        headers = rows[0].map((_, i) => (i === 0 ? "X" : `Y${i}`));
        body = rows;
      }
      headers = dedupeHeaders(headers);
      const ncols = headers.length;

      const col = {};
      headers.forEach((h) => (col[h] = { raw: [], num: null, isPercent: false }));
      for (const r of body) {
        for (let j = 0; j < ncols; j++) {
          col[headers[j]].raw.push(j < r.length ? String(r[j]).trim() : "");
        }
      }
      headers.forEach((h) => {
        const c = col[h];
        const firstNonEmpty = c.raw.find((v) => v !== "");
        c.isPercent = !!(firstNonEmpty && firstNonEmpty.endsWith("%"));
        c.num = Float64Array.from(c.raw, (v) => {
          if (v === "") return NaN;
          const s = c.isPercent ? v.replace(/%\s*$/, "") : v;
          const n = Number(s);
          return Number.isFinite(n) ? n : NaN;
        });
      });

      _state = { headers, nrows: body.length, col };
      _sel = { x: new Set(), y: new Set(), colorRef: new Set() };
      _sets = [];
      _filter = { col: null, included: [] };
      clearAxisLimits();

      LOG("dp columns built");
      populatePlotRefSelect();
      updateFilterStatus();
      updateUiStates();
      render();
      LOG("dp render done");
      summarizeInput(text, body.length, headers.length);
      setStatus(`Loaded ${body.length} rows × ${headers.length} columns. Pick X / Y in the Columns section.`);
    } catch (e) {
      LOG("dp doLoad ERROR", String(e && e.message || e));
      setStatus("Parse error: " + e.message, "error");
    }
  }

  function reset() {
    _state = null;
    _summaryText = null;
    _sel = { x: new Set(), y: new Set(), colorRef: new Set() };
    _sets = [];
    _filter = { col: null, included: [] };
    $("#dp-input").value = "";
    $("#dp-xlist").innerHTML = "";
    $("#dp-ylist").innerHTML = "";
    $("#dp-colorref-list").innerHTML = "";
    $("#dp-plotref-col").innerHTML = "";
    clearAxisLimits();
    updateFilterStatus();
    clearPlots();
    setStatus("Plot cleared.");
  }

  // ---------- Column list widgets ----------

  function ordered(set) {
    return _state ? _state.headers.filter((h) => set.has(h)) : [];
  }

  function renderColList(host, set, opts) {
    if (!host || !_state) return;
    host.innerHTML = "";
    _state.headers.forEach((name) => {
      const on = set.has(name);
      const item = el("div", { class: "collist-item" + (on ? " selected" : "") }, name);
      if (opts.single) {
        item.addEventListener("click", () => {
          set.clear();
          set.add(name);
          updateUiStates();
          render();
        });
      } else {
        // Multi-select: click toggles; press-and-drag paints the same toggle
        // action (add if the first item was unselected, else remove) across
        // every item the cursor passes over.
        item.addEventListener("mousedown", (e) => {
          if (e.preventDefault) e.preventDefault();
          _drag = { set, mode: set.has(name) ? "remove" : "add" };
          applyDrag(item, name);
        });
        item.addEventListener("mouseenter", () => {
          if (_drag && _drag.set === set) applyDrag(item, name);
        });
      }
      host.appendChild(item);
    });
  }

  function applyDrag(item, name) {
    if (!_drag) return;
    if (_drag.mode === "add") {
      if (!_drag.set.has(name)) { _drag.set.add(name); item.classList.add("selected"); }
    } else if (_drag.set.has(name)) {
      _drag.set.delete(name);
      item.classList.remove("selected");
    }
  }

  function endColDrag() {
    if (!_drag) return;
    _drag = null;
    updateUiStates();
    render();
  }

  // Reference split (Plot Ref / Color Ref) needs a single X and a single Y.
  function refAvailable() {
    return !!_state && $("#dp-mode-single").checked && ordered(_sel.y).length <= 1;
  }

  function renderLists() {
    if (!_state) return;
    renderColList($("#dp-xlist"), _sel.x, { single: $("#dp-mode-single").checked });
    renderColList($("#dp-ylist"), _sel.y, { single: false });
    renderColList($("#dp-colorref-list"), _sel.colorRef, { single: false });
  }

  function populatePlotRefSelect() {
    const sel = $("#dp-plotref-col");
    sel.innerHTML = "";
    _state.headers.forEach((h) => sel.appendChild(el("option", { value: h }, h)));
  }

  // Render the editable list of (X, Y) sets for the Paired X/Y mode.
  function renderSets() {
    const host = $("#dp-sets-list");
    if (!host) return;
    host.innerHTML = "";
    if (!_state) return;
    // Drop sets whose column is no longer in the loaded headers.
    _sets = _sets.filter((s) => _state.headers.includes(s.x) && _state.headers.includes(s.y));
    if (!_sets.length) {
      host.appendChild(el("div", { class: "pref-hint", style: "margin:6px 0;" }, "Click “+ Add set” to begin."));
      return;
    }
    _sets.forEach((s, i) => {
      const row = el("div", { class: "dp-set-row" });
      const nameInp = el("input", { type: "text", value: s.name, placeholder: `Set ${i + 1}` });
      nameInp.addEventListener("input", () => { s.name = nameInp.value; render(); });
      const xSel = el("select"); _state.headers.forEach((h) => xSel.appendChild(el("option", { value: h }, h))); xSel.value = s.x;
      const ySel = el("select"); _state.headers.forEach((h) => ySel.appendChild(el("option", { value: h }, h))); ySel.value = s.y;
      xSel.addEventListener("change", () => { s.x = xSel.value; render(); });
      ySel.addEventListener("change", () => { s.y = ySel.value; render(); });
      const rm = el("button", { class: "mini" }, "✕");
      rm.addEventListener("click", () => { _sets.splice(i, 1); renderSets(); render(); });
      row.append(
        el("span", { class: "dp-set-num" }, String(i + 1)),
        nameInp,
        el("span", { class: "dp-set-lab" }, "X"), xSel,
        el("span", { class: "dp-set-lab" }, "Y"), ySel,
        rm,
      );
      host.appendChild(row);
    });
  }

  function addSet() {
    if (!_state) return;
    const i = _sets.length;
    const x = _state.headers[0];
    const y = _state.headers[Math.min(1, _state.headers.length - 1)];
    _sets.push({ name: `Set ${i + 1}`, x, y });
    renderSets();
    render();
  }

  function updateUiStates() {
    if (!_state) return;
    const isSingle = $("#dp-mode-single").checked;
    const isPaired = $("#dp-mode-pairs").checked;
    $("#dp-single-opts").style.display = (isSingle && !isPaired) ? "" : "none";
    $("#dp-xylist-wrap").style.display = isPaired ? "none" : "";
    $("#dp-sets-wrap").style.display = isPaired ? "" : "none";
    if (isPaired) renderSets();

    // X is single-select in single mode; Y is always multi-select.
    if (isSingle && !isPaired && _sel.x.size > 1) {
      const f = ordered(_sel.x)[0];
      _sel.x = new Set(f ? [f] : []);
    }

    // Reference split is disabled in Multiple-X / Paired modes or when >1 Y is selected.
    const refOk = refAvailable() && !isPaired;
    $("#dp-ref-opts").classList.toggle("disabled", !refOk);
    const reason = $("#dp-ref-reason");
    if (refOk) {
      reason.classList.add("hidden");
      reason.textContent = "";
    } else {
      reason.classList.remove("hidden");
      reason.textContent = isPaired
        ? "Disabled in Paired X/Y mode — each set already pairs its own X with its Y."
        : (!isSingle
          ? "Disabled in Multiple-X mode — switch to Single-X to use reference split."
          : "Disabled while multiple Y columns are selected — keep a single Y.");
    }
    // Plot Ref and Color Ref are mutually exclusive: enabling one greys the
    // other out.
    const plotRefOn = refOk && $("#dp-plotref").checked;
    const colorRefOn = refOk && $("#dp-colorref").checked;
    $("#dp-plotref-row").classList.toggle("disabled", colorRefOn);
    $("#dp-colorref-row").classList.toggle("disabled", plotRefOn);
    $("#dp-plotref-col").disabled = !plotRefOn;
    $("#dp-colorref-list").classList.toggle("disabled", !colorRefOn);

    renderLists();
  }

  // ---------- Filter dialog ----------

  function uniqueValues(colName) {
    const seen = [];
    const set = new Set();
    for (const v of _state.col[colName].raw) {
      if (!set.has(v)) { set.add(v); seen.push(v); }
    }
    return seen;
  }

  function openFilter() {
    if (!_state) { setStatus("Load data first.", "warn"); return; }
    const sel = $("#dp-filter-col");
    sel.innerHTML = "";
    _state.headers.forEach((h) => sel.appendChild(el("option", { value: h }, h)));
    const colName = (_filter.col && _state.headers.includes(_filter.col)) ? _filter.col : _state.headers[0];
    sel.value = colName;
    initFilterDraft(colName);
    $("#dp-filter-modal").classList.remove("hidden");
  }

  function initFilterDraft(colName) {
    const vals = uniqueValues(colName);
    let included, excluded;
    if (_filter.col === colName && _filter.included.length) {
      const inc = new Set(_filter.included);
      included = vals.filter((v) => inc.has(v));
      excluded = vals.filter((v) => !inc.has(v));
    } else {
      included = vals.slice();
      excluded = [];
    }
    _filterDraft = { col: colName, included, excluded };
    renderFilterLists();
  }

  function renderFilterLists() {
    const excl = $("#dp-filter-excl");
    const incl = $("#dp-filter-incl");
    excl.innerHTML = "";
    incl.innerHTML = "";
    const label = (v) => (v === "" ? "(empty)" : v);
    _filterDraft.excluded.forEach((v) => {
      const it = el("div", { class: "collist-item" }, label(v));
      it.addEventListener("click", () => moveFilter(v, false));
      excl.appendChild(it);
    });
    _filterDraft.included.forEach((v) => {
      const it = el("div", { class: "collist-item" }, label(v));
      it.addEventListener("click", () => moveFilter(v, true));
      incl.appendChild(it);
    });
  }

  function moveFilter(v, fromIncluded) {
    if (fromIncluded) {
      _filterDraft.included = _filterDraft.included.filter((x) => x !== v);
      _filterDraft.excluded.push(v);
    } else {
      _filterDraft.excluded = _filterDraft.excluded.filter((x) => x !== v);
      _filterDraft.included.push(v);
    }
    renderFilterLists();
  }

  function moveAllFilter(toIncluded) {
    if (toIncluded) {
      _filterDraft.included = _filterDraft.included.concat(_filterDraft.excluded);
      _filterDraft.excluded = [];
    } else {
      _filterDraft.excluded = _filterDraft.excluded.concat(_filterDraft.included);
      _filterDraft.included = [];
    }
    renderFilterLists();
  }

  function applyFilter() {
    if (!_filterDraft) return closeFilter();
    if (_filterDraft.excluded.length === 0) {
      _filter = { col: null, included: [] };
    } else if (_filterDraft.included.length === 0) {
      _filter = { col: null, included: [] };
      setStatus("Filter not applied: nothing in Included.", "warn");
    } else {
      _filter = { col: _filterDraft.col, included: _filterDraft.included.slice() };
    }
    closeFilter();
    updateFilterStatus();
    render();
  }

  function clearFilter() {
    _filter = { col: null, included: [] };
    closeFilter();
    updateFilterStatus();
    render();
  }

  function closeFilter() {
    $("#dp-filter-modal").classList.add("hidden");
  }

  function updateFilterStatus() {
    const s = $("#dp-filter-status");
    if (!s) return;
    s.textContent = _filter.col
      ? `Filter on "${_filter.col}": ${_filter.included.length} value(s) included.`
      : "No filter.";
  }

  // ---------- Plot grouping ----------

  function range(n) {
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = i;
    return a;
  }

  function getTargetGhostIndices() {
    const n = _state.nrows;
    if (!_filter.col || _filter.included.length === 0) {
      return { target: range(n), ghost: [] };
    }
    const raw = _state.col[_filter.col].raw;
    const inc = new Set(_filter.included);
    const target = [];
    const ghost = [];
    for (let i = 0; i < n; i++) (inc.has(raw[i]) ? target : ghost).push(i);
    return { target, ghost };
  }

  function buildGroups(targetIdx, xs, ys, isSingle, usePlotRef, isPaired) {
    if (isPaired) {
      // Paired mode: one canvas, one series per (x, y) set.
      const pairs = _sets.filter((s) => s.x && s.y && _state.headers.includes(s.x) && _state.headers.includes(s.y));
      if (!pairs.length) return [];
      return [{ title: "", idx: targetIdx, pairs }];
    }
    if (usePlotRef) {
      const refCol = $("#dp-plotref-col").value;
      const raw = _state.col[refCol].raw;
      const order = [];
      const map = new Map();
      for (const i of targetIdx) {
        const v = raw[i];
        if (!map.has(v)) { map.set(v, []); order.push(v); }
        map.get(v).push(i);
      }
      return order.map((v) => ({
        title: `${refCol}: ${v === "" ? "(empty)" : v}`,
        idx: map.get(v), xs, ys,
      }));
    }
    if (!isSingle) {
      return xs.map((x) => ({ title: x, idx: targetIdx, xs: [x], ys }));
    }
    if ($("#dp-ymode-ovl").checked) {
      return [{ title: "", idx: targetIdx, xs, ys }];
    }
    return ys.map((y) => ({ title: y, idx: targetIdx, xs, ys: [y] }));
  }

  // ---------- Rendering ----------

  function colorFor(index, total, palette, fallbackCmap) {
    if (total <= palette.length) return palette[index % palette.length];
    const t = total > 1 ? index / (total - 1) : 0;
    const [r, g, b] = PL.cmapLookup(fallbackCmap || "viridis", t);
    return `rgb(${r},${g},${b})`;
  }

  function markerOpts(color, o) {
    if (o.markerFill === "hollow") {
      return { markerSize: o.ms, fill: false, strokeColor: color, strokeWidth: 1.3 };
    }
    if (o.markerOutline) {
      return { markerSize: o.ms, fillColor: color, strokeColor: o.outlineColor, strokeWidth: 1 };
    }
    return { markerSize: o.ms, fillColor: color };
  }

  // Longest common starting substring (trimmed of trailing separators).
  function commonPrefix(strs) {
    if (!strs.length) return "";
    let p = String(strs[0]);
    for (let i = 1; i < strs.length; i++) {
      const s = String(strs[i]);
      let j = 0; while (j < p.length && j < s.length && p[j] === s[j]) j++;
      p = p.slice(0, j);
      if (!p) break;
    }
    return p.replace(/[_\-\s.()/[\]]+$/, "");
  }

  // Best axis title from a list of column names.
  function autoAxisTitle(cols, log) {
    const names = (cols || []).filter((n) => n && _state.col[n]);
    if (!names.length) return "value";
    const uniq = Array.from(new Set(names));
    if (uniq.length === 1) {
      const n = uniq[0];
      return (!log && _state.col[n].isPercent) ? `${n} (%)` : n;
    }
    return commonPrefix(uniq) || "value";
  }

  function valuesFor(colName, idx, log) {
    const num = _state.col[colName].num;
    return idx.map((i) => {
      const v = num[i];
      if (log) return v > 0 ? Math.log10(v) : NaN;
      return v;
    });
  }

  function clearPlots() {
    const host = $("#dp-plots");
    if (host) host.innerHTML = "";
  }

  function copyCanvas(canvas) {
    if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
      setStatus("Image clipboard copy isn't supported in this browser.", "warn");
      return;
    }
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        setStatus("Plot copied to clipboard.");
      } catch (e) {
        setStatus("Copy failed (needs HTTPS / clipboard permission).", "error");
      }
    }, "image/png");
  }

  // Tick positions (in log space) for a log axis: whole decades (one order of
  // magnitude each), thinned so labels never crowd. For a sub-decade range,
  // fall back to a few 1-2-5 positions so the axis isn't empty.
  function logAxisTicks(loLog, hiLog) {
    const kmin = Math.ceil(loLog - 1e-9);
    const kmax = Math.floor(hiLog + 1e-9);
    if (kmax >= kmin) {
      let stepK = 1;
      while (Math.floor((kmax - kmin) / stepK) + 1 > 12) stepK++;
      const ticks = [];
      for (let k = kmin; k <= kmax; k += stepK) ticks.push(k);
      return ticks;
    }
    const ticks = [];
    for (let k = Math.floor(loLog) - 1; k <= Math.ceil(hiLog) + 1; k++) {
      for (const m of [1, 2, 5]) {
        const pos = Math.log10(m) + k;
        if (pos >= loLog - 1e-9 && pos <= hiLog + 1e-9) ticks.push(pos);
      }
    }
    return ticks;
  }
  function axisTicks(loLog, hiLog, isLog) {
    return isLog ? logAxisTicks(loLog, hiLog) : PL.makeTicks(loLog, hiLog);
  }
    // Build one consistent label formatter for a whole axis:
  //   log  -> always scientific, of the original value (10^pos)
  //   linear -> scientific for all ticks when any |value| >= 1e4 or <= 1e-4
  //             (0 excluded), otherwise plain decimal (trimmed).
  function makeAxisLabeler(ticks, isLog) {
    if (isLog) return (pos) => U.fmtSci(Math.pow(10, pos));
    let maxAbs = 0, minAbs = Infinity;
    for (const t of ticks) {
      const a = Math.abs(t);
      if (a === 0) continue;
      if (a > maxAbs) maxAbs = a;
      if (a < minAbs) minAbs = a;
    }
    const bigExp = maxAbs > 0 ? Math.floor(Math.log10(maxAbs)) : 0;
    const smallExp = Number.isFinite(minAbs) ? Math.floor(Math.log10(minAbs)) : 0;
    const sci = bigExp >= 4 || smallExp <= -4;
    return sci ? (v) => U.fmtSci(v) : (v) => U.fmtDec(v);
  }

  function drawGrid(ctx, box, T, xt, yt) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of xt) {
      const p = T.toPx(x, T.yRange[0]);
      ctx.moveTo(p.x, box.y);
      ctx.lineTo(p.x, box.y + box.h);
    }
    for (const y of yt) {
      const p = T.toPx(T.xRange[0], y);
      ctx.moveTo(box.x, p.y);
      ctx.lineTo(box.x + box.w, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawLegend(ctx, box, entries, o) {
    if (!entries.length) return;
    const fam = o.legendFont || "system-ui";
    const size = o.legendFontSize || 11;
    const style = `${o.legendItalic ? "italic " : ""}${o.legendBold ? "bold " : ""}`;
    ctx.save();
    ctx.font = `${style}${size}px ${fam}`;
    const lineH = size + 4, sw = 18, pad = 6;
    let maxW = 0;
    for (const e of entries) maxW = Math.max(maxW, ctx.measureText(e.label).width);
    const boxW = sw + 6 + maxW + pad * 2;
    const boxH = entries.length * lineH + pad * 2;
    const right = box.x + box.w - boxW - 6;
    const left = box.x + 6;
    const top = box.y + 6;
    const bottom = box.y + box.h - boxH - 6;
    let x0 = right, y0 = top;
    const loc = o.legendLoc || "upper right";
    if (loc === "upper left") { x0 = left; y0 = top; }
    else if (loc === "lower left") { x0 = left; y0 = bottom; }
    else if (loc === "lower right") { x0 = right; y0 = bottom; }
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillRect(x0, y0, boxW, boxH);
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, boxW, boxH);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    entries.forEach((e, i) => {
      const yy = y0 + pad + i * lineH + lineH / 2;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x0 + pad, yy);
      ctx.lineTo(x0 + pad + sw, yy);
      ctx.stroke();
      ctx.fillStyle = "#222";
      ctx.fillText(e.label, x0 + pad + sw + 6, yy);
    });
    ctx.restore();
  }

  function drawGroup(ctx, rect, g, o) {
    const isPaired = !!g.pairs;
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    const acc = (arr, isX) => {
      for (const v of arr) {
        if (!Number.isFinite(v)) continue;
        if (isX) { if (v < xMin) xMin = v; if (v > xMax) xMax = v; }
        else { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
      }
    };
    if (isPaired) {
      for (const p of g.pairs) {
        acc(valuesFor(p.x, g.idx, o.logX), true);
        acc(valuesFor(p.y, g.idx, o.logY), false);
        if (o.showGhost) {
          acc(valuesFor(p.x, o.ghost, o.logX), true);
          acc(valuesFor(p.y, o.ghost, o.logY), false);
        }
      }
    } else {
      for (const x of g.xs) acc(valuesFor(x, g.idx, o.logX), true);
      for (const y of g.ys) acc(valuesFor(y, g.idx, o.logY), false);
      if (o.showGhost) {
        for (const x of g.xs) acc(valuesFor(x, o.ghost, o.logX), true);
        for (const y of g.ys) acc(valuesFor(y, o.ghost, o.logY), false);
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
      xMin = 0; xMax = 1; yMin = 0; yMax = 1;
    }
    const xPad = (xMax - xMin) * 0.05 || 0.5;
    const yPad = (yMax - yMin) * 0.05 || 0.5;
    xMin -= xPad; xMax += xPad; yMin -= yPad; yMax += yPad;

    // Global axis limits override the auto range (log axes take the raw value).
    const applyX = (v) => (o.logX ? (v > 0 ? Math.log10(v) : NaN) : v);
    const applyY = (v) => (o.logY ? (v > 0 ? Math.log10(v) : NaN) : v);
    if (o.xmin != null) { const v = applyX(o.xmin); if (Number.isFinite(v)) xMin = v; }
    if (o.xmax != null) { const v = applyX(o.xmax); if (Number.isFinite(v)) xMax = v; }
    if (o.ymin != null) { const v = applyY(o.ymin); if (Number.isFinite(v)) yMin = v; }
    if (o.ymax != null) { const v = applyY(o.ymax); if (Number.isFinite(v)) yMax = v; }

    // Axis titles: prefer the user override; else if all columns are the same
    // use that name; else use the common prefix across them (e.g. vth_0/vth_40
    // → "vth"); falling back to "value" only when nothing else fits.
    const xCols = isPaired ? g.pairs.map((p) => p.x) : g.xs;
    const yCols = isPaired ? g.pairs.map((p) => p.y) : g.ys;
    const xAuto = autoAxisTitle(xCols, o.logX);
    const yAuto = autoAxisTitle(yCols, o.logY);
    const xLab = o.xtitle || xAuto;
    const yLab = o.ytitle || yAuto;

    // Log axes: positions live in log space but labels show the original value.
    const xticks = axisTicks(xMin, xMax, o.logX);
    const yticks = axisTicks(yMin, yMax, o.logY);
    const xLabelFn = makeAxisLabeler(xticks, o.logX);
    const yLabelFn = makeAxisLabeler(yticks, o.logY);

    // Measure y-tick label widths so the left margin (and the y-title position)
    // hug the numbers instead of leaving a fixed-guess gap.
    ctx.save();
    ctx.font = `${o.tickItalic ? "italic " : ""}${o.tickBold ? "bold " : ""}${o.tickFontSize}px ${o.tickFont}`;
    let maxYW = 0;
    for (const t of yticks) maxYW = Math.max(maxYW, ctx.measureText(yLabelFn(t)).width);
    ctx.restore();

    // Padding scales with the chosen font sizes so ticks and titles never collide.
    const yTitleW = o.titleFontSize;        // rotated title's thickness ≈ font size
    const padTop = g.showTitle ? o.titleFontSize + 16 : 12;
    const padBottom = o.tickFontSize + o.titleFontSize + 22;
    const padLeft = 18 + yTitleW + Math.ceil(maxYW);
    const ylabelX = rect.x + 6 + yTitleW / 2;
    const box = PL.plotBox(rect, { padLeft, padRight: 16, padTop, padBottom });
    const T = PL.makeTransform(box, [xMin, xMax], [yMin, yMax]);
    PL.drawAxes(ctx, rect, {
      title: g.showTitle ? g.title : null,
      xlabel: xLab, ylabel: yLab, ylabelX,
      box, transform: T, xRange: [xMin, xMax], yRange: [yMin, yMax],
      xTicks: xticks, yTicks: yticks,
      xTickLabel: xLabelFn,
      yTickLabel: yLabelFn,
      tickFont: o.tickFont, tickFontSize: o.tickFontSize, tickBold: o.tickBold, tickItalic: o.tickItalic,
      titleFont: o.titleFont, titleFontSize: o.titleFontSize, titleBold: o.titleBold, titleItalic: o.titleItalic,
      frameLineWidth: o.frameLineWidth, tickLineWidth: o.tickLineWidth,
    });
    if (o.showGrid) drawGrid(ctx, box, T, xticks, yticks);

    // Clip series (and ghost) to the plot box so manual axis limits crop the
    // data instead of letting it spill outside the frame.
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    if (o.showGhost) {
      if (isPaired) {
        for (const p of g.pairs) {
          PL.drawScatter(ctx, T, valuesFor(p.x, o.ghost, o.logX), valuesFor(p.y, o.ghost, o.logY),
            { color: "#E0E0E0", markerSize: o.ms });
        }
      } else {
        for (const x of g.xs) for (const y of g.ys) {
          PL.drawScatter(ctx, T, valuesFor(x, o.ghost, o.logX), valuesFor(y, o.ghost, o.logY),
            { color: "#E0E0E0", markerSize: o.ms });
        }
      }
    }

    const legend = [];
    if (isPaired) {
      g.pairs.forEach((p, j) => {
        const color = colorFor(j, g.pairs.length, o.palette, o.fallbackCmap);
        const X = valuesFor(p.x, g.idx, o.logX);
        const Y = valuesFor(p.y, g.idx, o.logY);
        if (o.showLines) PL.drawLine(ctx, T, X, Y, { color, lineWidth: o.lw });
        if (o.showPoints) PL.drawScatter(ctx, T, X, Y, markerOpts(color, o));
        legend.push({ label: p.name || `${p.x} vs ${p.y}`, color });
      });
    } else if (o.useColorRef) {
      const refCols = ordered(_sel.colorRef);
      const order = [];
      const map = new Map();
      for (const i of g.idx) {
        const k = refCols.map((c) => _state.col[c].raw[i]).join(" / ");
        if (!map.has(k)) { map.set(k, []); order.push(k); }
        map.get(k).push(i);
      }
      // Sort groups (numeric-aware) so the colormap / palette maps low -> high
      // consistently regardless of row order in the data.
      order.sort((a, b) => {
        const na = Number(a), nb = Number(b);
        if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b), undefined, { numeric: true });
      });
      order.forEach((k, ci) => {
        const color = colorFor(ci, order.length, o.palette, o.fallbackCmap);
        const sub = map.get(k);
        for (const x of g.xs) for (const y of g.ys) {
          const X = valuesFor(x, sub, o.logX);
          const Y = valuesFor(y, sub, o.logY);
          if (o.showLines) PL.drawLine(ctx, T, X, Y, { color, lineWidth: o.lw });
          if (o.showPoints) PL.drawScatter(ctx, T, X, Y, markerOpts(color, o));
        }
        legend.push({ label: k === "" ? "(empty)" : k, color });
      });
    } else {
      g.ys.forEach((y, j) => {
        const color = colorFor(j, g.ys.length, o.palette, o.fallbackCmap);
        for (const x of g.xs) {
          const X = valuesFor(x, g.idx, o.logX);
          const Y = valuesFor(y, g.idx, o.logY);
          if (o.showLines) PL.drawLine(ctx, T, X, Y, { color, lineWidth: o.lw });
          if (o.showPoints) PL.drawScatter(ctx, T, X, Y, markerOpts(color, o));
        }
        legend.push({ label: y, color });
      });
    }
    ctx.restore();   // end series clip
    if (o.showLegend && legend.length > 1) drawLegend(ctx, box, legend, o);
  }

  function render() {
    if (!_state) return;
    const isSingle = $("#dp-mode-single").checked;
    const isPaired = $("#dp-mode-pairs").checked;
    const refOk = refAvailable() && !isPaired;
    const usePlotRef = refOk && $("#dp-plotref").checked &&
      _state.headers.includes($("#dp-plotref-col").value);
    const useColorRef = refOk && $("#dp-colorref").checked && _sel.colorRef.size > 0;

    let xs = ordered(_sel.x);
    let ys = ordered(_sel.y);
    if (isSingle && !isPaired) xs = xs.slice(0, 1);
    if (isPaired) {
      const validSets = _sets.filter((s) => s.x && s.y && _state.headers.includes(s.x) && _state.headers.includes(s.y));
      if (!validSets.length) {
        clearPlots();
        setStatus("Add at least one (X, Y) set (Columns section).", "warn");
        return;
      }
    } else if (!xs.length || !ys.length) {
      clearPlots();
      setStatus("Select at least one X and one Y column (Columns section).", "warn");
      return;
    }

    const { target, ghost } = getTargetGhostIndices();
    const groups = buildGroups(target, xs, ys, isSingle, usePlotRef, isPaired);
    if (!groups.length) { clearPlots(); return; }

    // Title only when there's more than one subplot, or when Plot Ref splits
    // the data (so the user can see what each panel represents).
    const showTitles = usePlotRef || groups.length > 1;
    groups.forEach((g) => { g.showTitle = showTitles && !!g.title; });

    const cfg = window.LUMOS_config.load();
    const cols = Math.max(1, Number($("#dp-cols").value) || cfg.plot_columns || 2);
    const cellW = Number($("#dp-subw").value) || (cfg.subplot_size && cfg.subplot_size[0]) || 500;
    const cellH = Number($("#dp-subh").value) || (cfg.subplot_size && cfg.subplot_size[1]) || 400;
    const usedCols = Math.min(cols, groups.length);

    const o = Object.assign(getDisplayOpts(), {
      ghost,
      showGhost: $("#dp-ghost").checked && ghost.length > 0,
      palette: cfg.priority_colors || window.LUMOS_config.DEFAULT_PRIORITY_COLORS,
      fallbackCmap: cfg.fallback_colormap || "viridis",
      useColorRef,
    });

    const host = $("#dp-plots");
    host.innerHTML = "";
    host.style.gridTemplateColumns = `repeat(${usedCols}, ${cellW}px)`;

    groups.forEach((g) => {
      const cell = el("div", { class: "dp-plot-cell" });
      const canvas = el("canvas", {});
      cell.appendChild(canvas);
      const copyBtn = el("button", {}, "Copy");
      copyBtn.addEventListener("click", () => copyCanvas(canvas));
      cell.appendChild(el("div", { class: "dp-plot-tools" }, [copyBtn]));
      host.appendChild(cell);

      const ctx = PL.fitCanvas(canvas, cellW, cellH);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cellW, cellH);
      drawGroup(ctx, { x: 0, y: 0, w: cellW, h: cellH }, g, o);
    });
    setStatus(`Plotted ${groups.length} subplot(s).`);
  }

  // ---------- Events ----------

  function onDocPaste(e) {
    const tab = $("section.tab-panel.active");
    if (!tab || tab.dataset.tab !== "plot") return;
    if (e.target && e.target.id === "dp-input") return;
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData("text") : "";
    if (!text) return;
    e.preventDefault();
    U.runWithBusy($("#dp-busy"), () => doLoad(text));
  }

  const DISPLAY_IDS = [
    "dp-style", "dp-lw", "dp-ms", "dp-marker-fill", "dp-marker-outline", "dp-marker-outline-color",
    "dp-xmin", "dp-xmax", "dp-ymin", "dp-ymax",
    "dp-xtitle", "dp-ytitle",
    "dp-logx", "dp-logy", "dp-grid",
    "dp-legend", "dp-legend-loc", "dp-legend-font", "dp-legend-size", "dp-legend-bold", "dp-legend-italic",
    "dp-tick-font", "dp-tick-size", "dp-tick-bold", "dp-tick-italic",
    "dp-title-font", "dp-title-size", "dp-title-bold", "dp-title-italic",
    "dp-frame-lw", "dp-tick-lw",
    "dp-cols", "dp-subw", "dp-subh",
  ];

  function bindEvents() {
    $("#dp-load").addEventListener("click", loadFromTextarea);
    $("#dp-clip").addEventListener("click", loadFromClipboard);
    $("#dp-reset").addEventListener("click", reset);
    $("#dp-input").addEventListener("paste", onInputPaste);

    ["dp-mode-single", "dp-mode-multi", "dp-mode-pairs"].forEach((id) =>
      $("#" + id).addEventListener("change", () => { updateUiStates(); render(); }));
    $("#dp-sets-add").addEventListener("click", addSet);
    ["dp-ymode-sub", "dp-ymode-ovl"].forEach((id) =>
      $("#" + id).addEventListener("change", render));
    $("#dp-plotref").addEventListener("change", () => { updateUiStates(); render(); });
    $("#dp-colorref").addEventListener("change", () => { updateUiStates(); render(); });
    $("#dp-plotref-col").addEventListener("change", render);
    $("#dp-ghost").addEventListener("change", render);

    const onDisplayChange = () => { _persist(); render(); };
    DISPLAY_IDS.forEach((id) => {
      const e = $("#" + id);
      if (!e) return;
      e.addEventListener("change", onDisplayChange);
      e.addEventListener("input", onDisplayChange);
    });

    $("#dp-filter-open").addEventListener("click", openFilter);
    $("#dp-filter-cancel").addEventListener("click", closeFilter);
    $("#dp-filter-apply").addEventListener("click", applyFilter);
    $("#dp-filter-clear").addEventListener("click", clearFilter);
    $("#dp-filter-col").addEventListener("change", () => initFilterDraft($("#dp-filter-col").value));
    $("#dp-filter-allin").addEventListener("click", () => moveAllFilter(true));
    $("#dp-filter-allout").addEventListener("click", () => moveAllFilter(false));
    $("#dp-filter-modal").addEventListener("click", (e) => {
      if (e.target.id === "dp-filter-modal") closeFilter();
    });

    document.addEventListener("paste", onDocPaste);
    document.addEventListener("mouseup", endColDrag);
  }

  // ---------- Lifecycle ----------

  function init(root) {
    buildUI(root);
    _persist = U.debounce(persistDisplay, 300);
    initDisplayControls();
    bindEvents();
    window.addEventListener("resize", U.debounce(() => { if (_state) render(); }, 200));
  }

  function onShow() {
    if (_state) requestAnimationFrame(render);
  }

  function onSettingsChanged() {
    if (_state) render();
  }

  window.LUMOS_tab_plot = { init, onShow, onSettingsChanged, loadFromClipboard };
})();


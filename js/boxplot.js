// Box Plot tab — port of LUMOS_boxplot.py. 3-column master-detail
// (Data / Columns / Style) + a Plot / Stats tabbed view on the right.
// Wide mode: one box per selected numeric column. Long mode: box per group
// value; with a box-split ref column, sub-boxes per ref value within each
// group (coloured from the boxplot palette).
"use strict";

(function () {
  const U = window.LUMOS_util;
  const { el, $, $$, setStatus } = U;
  const P = window.LUMOS_parse;
  const N = window.LUMOS_numerics;
  const PL = window.LUMOS_plotting;

  const FONTS = ["system-ui", "Arial", "Helvetica", "Georgia", "Times New Roman", "Courier New", "monospace"];
  const MAX_X_GROUPS = 60;
  const MAX_REF_GROUPS = 6;
  const SUB_DEFAULT_W = 460, SUB_DEFAULT_H = 360;   // per-panel size when Canvas W/H is auto (subplots)
  const MAX_INPUT_CHARS = 25_000_000;   // refuse pastes bigger than this (memory safety)
  const MAX_CELLS = 3_000_000;          // refuse rows×cols beyond this
  const SUMMARIZE_CHARS = 100_000;      // above this, show a summary instead of the raw text in the textarea
  let _summaryText = null;
  let _pasteViaKey = 0;                 // timestamp of a Ctrl+V intercepted at keydown
  const LOG = (m, x) => { if (window.LUMOS_log) window.LUMOS_log.log(m, x); };
  const canReadClip = () => !!(navigator.clipboard && navigator.clipboard.readText);

  let _data = null;          // { headers, nrows, col:{name:{raw,num,isPercent}} }
  let _wideSel = new Set();  // selected wide columns
  let _persist = null;
  let _boxCache = null;      // cached box data + per-group stats
  let _dataVersion = 0;      // bumped on data load
  const JITTER_CAP = 1500;   // max jitter points drawn per box (subsampled)

  // ---------- element helpers ----------
  function block(title, children) { return el("div", { class: "dp-block" }, [el("h4", {}, title)].concat(children)); }
  function prefRow(label, input) { return el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, label), input]); }
  function selectEl(id, opts) { const s = el("select", { id }); opts.forEach(([v, l]) => s.appendChild(el("option", { value: v }, l))); return s; }
  function numEl(id, val, a) { const e = el("input", { type: "number", id, value: String(val) }); a = a || {}; if (a.step != null) e.setAttribute("step", a.step); if (a.min != null) e.setAttribute("min", a.min); if (a.max != null) e.setAttribute("max", a.max); return e; }
  function chk(id, c, label) { return el("label", { style: "display:block;" }, [c ? el("input", { type: "checkbox", id, checked: true }) : el("input", { type: "checkbox", id }), " " + label]); }
  function colorEl(id, v) { return el("input", { type: "color", id, value: v }); }
  function txtEl(id, ph) { return el("input", { type: "text", id, placeholder: ph || "" }); }
  function radio(name, v, label, checked) { return el("label", {}, [checked ? el("input", { type: "radio", name, value: v, checked: true }) : el("input", { type: "radio", name, value: v }), " " + label]); }

  // ---------- UI ----------
  function buildUI(root) {
    root.innerHTML = "";
    const layout = el("div", { class: "dp-layout" });
    root.appendChild(layout);

    const nav = el("ul", { class: "dp-nav", id: "bp-nav" });
    [["data", "Data"], ["columns", "Columns"], ["style", "Style"]].forEach(([id, label], i) => {
      const li = el("li", { "data-sec": id, class: i === 0 ? "active" : "" }, label);
      li.addEventListener("click", () => showSection(id));
      nav.appendChild(li);
    });
    layout.appendChild(nav);

    const panel = el("div", { class: "dp-sections", id: "bp-sections" });
    layout.appendChild(panel);

    panel.appendChild(el("div", { class: "dp-section active", "data-sec": "data" }, [
      el("div", { class: "hint" }, "Paste TSV/CSV. Wide = columns of values; Long = (group, value [, split]) rows."),
      el("textarea", { id: "bp-input", rows: 8, placeholder: "A\tB\tC\n1.2\t2.1\t3.0\n1.3\t2.4\t3.1\n..." }),
      el("div", { class: "pref-hint", style: "margin:0 0 6px;" }, "For large Excel data, use “Paste from clipboard” — Ctrl+V can choke on Excel’s hidden HTML copy."),
      el("div", { class: "row" }, [
        el("button", { id: "bp-clip", class: "primary" }, "Paste from clipboard"),
        el("button", { id: "bp-load" }, "Load textarea"),
        el("button", { id: "bp-reset" }, "Reset"),
      ]),
      block("Format", [
        radio("bp-mode", "wide", "Wide (columns)", true),
        radio("bp-mode", "long", "Long (group / value)"),
      ]),
    ]));

    panel.appendChild(el("div", { class: "dp-section", "data-sec": "columns" }, [
      el("div", { id: "bp-wide-wrap" }, [
        el("label", { class: "field-label" }, "Value columns"),
        el("div", { id: "bp-wide-cols", class: "collist" }),
      ]),
      el("div", { id: "bp-long-wrap" }, [
        prefRow("Value", selectEl("bp-long-val", [])),
        prefRow("Group (X)", selectEl("bp-long-group", [])),
        prefRow("Box split", selectEl("bp-long-ref", [])),
        prefRow("Split layout", selectEl("bp-split-layout", [["side", "Side-by-side boxes"], ["subplot", "Subplots"]])),
        el("div", { class: "pref-hint" }, `Box split adds sub-boxes per value (≤ ${MAX_REF_GROUPS}); ≤ ${MAX_X_GROUPS} X groups.`),
      ]),
    ]));

    panel.appendChild(el("div", { class: "dp-section", "data-sec": "style" }, [
      block("Boxes", [
        prefRow("Box width", numEl("bp-box-width", 0.6, { min: 0.1, max: 1.0, step: 0.05 })),
        prefRow("Box color", colorEl("bp-box-color", "#ADD8E6")),
        chk("bp-color-seq", false, "Use color sequence (palette)"),
      ]),
      block("Legend", [
        el("div", { class: "pref-hint" }, "For side-by-side box split (drawn inside the plot)."),
        prefRow("Position", selectEl("bp-legend-loc", [
          ["upper right", "Upper right"], ["upper left", "Upper left"],
          ["lower right", "Lower right"], ["lower left", "Lower left"],
        ])),
        prefRow("Font", selectEl("bp-legend-font", FONTS.map((f) => [f, f]))),
        prefRow("Size", numEl("bp-legend-size", 11, { min: 5, max: 30 })),
      ]),
      block("Overlays", [
        chk("bp-jitter", true, "Jitter points"),
        chk("bp-mean", true, "Mean marker"),
        chk("bp-outliers", true, "Outliers (1.5·IQR whiskers)"),
      ]),
      block("Axes & font", [
        chk("bp-log", false, "Log Y"),
        chk("bp-grid", true, "Grid"),
        prefRow("Tick font", selectEl("bp-tick-font", FONTS.map((f) => [f, f]))),
        prefRow("Tick size", numEl("bp-tick-size", 11, { min: 5, max: 40 })),
        chk("bp-tick-bold", false, "Tick bold"),
        prefRow("X label angle", selectEl("bp-xlabel-rot", [
          ["auto", "Auto"], ["horizontal", "Horizontal"], ["diagonal", "Diagonal (45°)"], ["vertical", "Vertical (90°)"],
        ])),
        prefRow("Frame width", numEl("bp-frame-lw", 1, { min: 0.5, max: 6, step: 0.5 })),
      ]),
      block("Labels", [
        prefRow("X label", txtEl("bp-xlabel", "(none)")),
        prefRow("Y label", txtEl("bp-ylabel", "(none)")),
        prefRow("Label font", selectEl("bp-label-font", FONTS.map((f) => [f, f]))),
        prefRow("Label size", numEl("bp-label-size", 13, { min: 6, max: 40 })),
        chk("bp-label-bold", false, "Label bold"),
      ]),
      block("Canvas", [
        prefRow("Width", txtEl("bp-canvas-w", "auto")),
        prefRow("Height", txtEl("bp-canvas-h", "auto")),
        prefRow("Subplot cols", numEl("bp-subplot-cols", 2, { min: 1, max: 6 })),
      ]),
      block("Y limits", [
        prefRow("Y min", txtEl("bp-ymin", "auto")),
        prefRow("Y max", txtEl("bp-ymax", "auto")),
      ]),
    ]));

    // Column 3: Plot / Stats tabs
    const col = el("div", { class: "dp-canvas-col" });
    col.appendChild(el("ul", { class: "map-tabs", id: "bp-tabs" }, [
      el("li", { "data-pane": "plot", class: "active" }, "Plot"),
      el("li", { "data-pane": "stats" }, "Stats"),
    ]));
    col.appendChild(el("div", { class: "map-pane active", "data-pane": "plot" }, [
      el("div", { class: "dp-actions" }, [
        el("span", { class: "hint" }, "Each plot has its own Copy / Save button (top-right)."),
        el("span", { class: "spacer" }),
        el("span", { id: "bp-info", class: "hint" }, ""),
      ]),
      el("div", { class: "plot-area", id: "bp-plot-area" }, [
        el("div", { id: "bp-plots" }),
        el("div", { class: "plot-busy", id: "bp-busy" }, [
          el("div", { class: "busy-card" }, [el("div", { class: "spinner" }), el("div", { class: "busy-text" }, "Loading data…")]),
        ]),
      ]),
    ]));
    col.appendChild(el("div", { class: "map-pane", "data-pane": "stats" }, [
      el("div", { class: "dp-actions" }, [
        el("span", { class: "field-label", style: "margin:0;" }, "Per-group statistics"),
        el("span", { class: "spacer" }),
        el("button", { id: "bp-copy-stats" }, "Copy"),
      ]),
      el("div", { class: "table-container", id: "bp-stats-host", style: "flex:1;" }),
    ]));
    layout.appendChild(col);
  }

  function showSection(id) {
    $$("#bp-nav li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-sec") === id));
    $$("#bp-sections .dp-section").forEach((s) => s.classList.toggle("active", s.getAttribute("data-sec") === id));
  }
  function activePane() {
    const li = $$("#bp-tabs li").find((x) => x.classList.contains("active"));
    return li ? li.getAttribute("data-pane") : "plot";
  }
  function showPane(name) {
    $$("#bp-tabs li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-pane") === name));
    $$(".map-pane", $("#bp-tabs").parentNode).forEach((p) => p.classList.toggle("active", p.getAttribute("data-pane") === name));
    if (name === "plot" && _data) window.requestAnimationFrame(renderPlot);
    if (name === "stats") renderStats();
  }

  // ---------- settings ----------
  function restoreSettings() {
    const bs = window.LUMOS_config.load().boxplot_settings || {};
    const setV = (id, v) => { const e = $("#" + id); if (e != null && v != null) e.value = v; };
    const setC = (id, v) => { const e = $("#" + id); if (e) e.checked = !!v; };
    $$('input[name="bp-mode"]').forEach((r) => { r.checked = r.value === (bs.mode || "wide"); });
    setV("bp-box-width", bs.box_width != null ? bs.box_width : 0.6);
    setV("bp-box-color", bs.box_color || "#ADD8E6");
    setC("bp-color-seq", bs.use_color_sequence);
    setC("bp-jitter", bs.show_jitter !== false);
    setC("bp-mean", bs.show_mean !== false);
    setC("bp-outliers", bs.show_outliers !== false);
    setC("bp-log", bs.log_y);
    setC("bp-grid", bs.show_grid !== false);
    setV("bp-tick-font", bs.tick_font || "system-ui");
    setV("bp-tick-size", bs.tick_size != null ? bs.tick_size : 11);
    setC("bp-tick-bold", bs.tick_bold);
    setV("bp-xlabel-rot", bs.xlabel_rot || "auto");
    setV("bp-label-font", bs.label_font || "system-ui");
    setV("bp-label-size", bs.label_size != null ? bs.label_size : 13);
    setC("bp-label-bold", bs.label_bold);
    setV("bp-split-layout", bs.split_layout || "side");
    setV("bp-legend-loc", bs.legend_loc || "upper right");
    setV("bp-legend-font", bs.legend_font || "system-ui");
    setV("bp-legend-size", bs.legend_size != null ? bs.legend_size : 11);
    setV("bp-frame-lw", bs.frame_line_width != null ? bs.frame_line_width : 1);
    setV("bp-xlabel", bs.xlabel || "");
    setV("bp-ylabel", bs.ylabel || "");
    setV("bp-canvas-w", bs.canvas_width || "");
    setV("bp-canvas-h", bs.canvas_height || "");
    setV("bp-subplot-cols", bs.subplot_cols != null ? bs.subplot_cols : 2);
    setV("bp-ymin", bs.ylim_min || "");
    setV("bp-ymax", bs.ylim_max || "");
  }

  function persistSettings() {
    window.LUMOS_config.update({
      boxplot_settings: {
        mode: ($$('input[name="bp-mode"]').find((r) => r.checked) || {}).value || "wide",
        box_width: Number($("#bp-box-width").value) || 0.6,
        box_color: $("#bp-box-color").value,
        use_color_sequence: $("#bp-color-seq").checked,
        show_jitter: $("#bp-jitter").checked,
        show_mean: $("#bp-mean").checked,
        show_outliers: $("#bp-outliers").checked,
        log_y: $("#bp-log").checked,
        show_grid: $("#bp-grid").checked,
        tick_font: $("#bp-tick-font").value,
        tick_size: Number($("#bp-tick-size").value) || 11,
        tick_bold: $("#bp-tick-bold").checked,
        xlabel_rot: $("#bp-xlabel-rot").value,
        label_font: $("#bp-label-font").value,
        label_size: Number($("#bp-label-size").value) || 13,
        label_bold: $("#bp-label-bold").checked,
        split_layout: $("#bp-split-layout").value,
        legend_loc: $("#bp-legend-loc").value,
        legend_font: $("#bp-legend-font").value,
        legend_size: Number($("#bp-legend-size").value) || 11,
        frame_line_width: Number($("#bp-frame-lw").value) || 1,
        xlabel: $("#bp-xlabel").value,
        ylabel: $("#bp-ylabel").value,
        canvas_width: $("#bp-canvas-w").value,
        canvas_height: $("#bp-canvas-h").value,
        subplot_cols: Number($("#bp-subplot-cols").value) || 2,
        ylim_min: $("#bp-ymin").value,
        ylim_max: $("#bp-ymax").value,
      },
    });
  }

  // ---------- data ----------
  function dedupeHeaders(headers) {
    const seen = new Map();
    return headers.map((h) => {
      let name = (h && String(h).trim()) || "col";
      if (seen.has(name)) { const k = seen.get(name) + 1; seen.set(name, k); return `${name}_${k}`; }
      seen.set(name, 1); return name;
    });
  }

  function loadFromTextarea() {
    const text = $("#bp-input").value;
    if (!text.trim()) return;
    if (_summaryText && text === _summaryText) return;
    setBusy(true);
    deferHeavy(() => doLoad(text));
  }

  // Replace a huge pasted blob in the textarea with a short summary so the Data
  // section stays responsive (re-showing a multi-MB textarea freezes). Data
  // lives in memory; paste again to replace.
  function summarizeInput(text, nrows, ncols) {
    const ta = $("#bp-input");
    if (text.length <= SUMMARIZE_CHARS) { _summaryText = null; ta.value = text; return; }
    const ko = window.LUMOS_i18n && window.LUMOS_i18n.lang && window.LUMOS_i18n.lang() === "ko";
    _summaryText = ko
      ? `✓ ${nrows}행 × ${ncols}열 불러옴.\n(응답성 유지를 위해 붙여넣은 데이터는 숨겼습니다 — 다시 붙여넣으면 교체됩니다.)`
      : `✓ Loaded ${nrows} rows × ${ncols} columns.\n(Pasted data hidden to stay responsive — paste again to replace.)`;
    ta.value = _summaryText;
  }

  // Run heavy work only after the browser has painted the busy overlay (two
  // leading rAFs), then keep the overlay up for two more frames so the *trailing*
  // freeze — the browser laying out the huge pasted textarea + the new plot —
  // also happens while the spinner is still showing, not after it's gone.
  function deferHeavy(fn) {
    const hide = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => setBusy(false)));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      try { fn(); } finally { hide(); }
    }));
  }

  function setBusy(on) {
    const o = $("#bp-busy");
    if (o) o.classList.toggle("show", !!on);
    if (on) setStatus("Loading data…", "warn");
  }

  // Intercept paste so the loader shows before the (blocking) textarea insert +
  // parse. Otherwise the browser inserts the huge text and repaints the
  // textarea first, and the spinner only appears once that freeze is over.
  // Read text/plain directly from the clipboard (a button click). Avoids the
  // Ctrl+V paste event, which materialises ALL clipboard formats — including
  // Excel's huge hidden HTML table — and can OOM-crash the tab.
  function loadFromClipboard() {
    LOG("bp clip:click");
    U.readClipboardText().then((t) => {
      LOG("bp clip:read", { chars: t ? t.length : 0 });
      if (!t) { setStatus("Clipboard has no text (or permission denied).", "warn"); return; }
      if (t.length > MAX_INPUT_CHARS) {
        setStatus(`Too large to load safely (${(t.length / 1e6).toFixed(1)}M chars). Select only the data range in Excel.`, "error");
        return;
      }
      setBusy(true);
      deferHeavy(() => doLoad(t));
    }).catch(() => setStatus("Clipboard read blocked (needs HTTPS / permission).", "warn"));
  }

  // Ctrl/Cmd+V intercepted before the paste event fires — preventing the
  // default stops the browser materialising ALL clipboard formats (incl.
  // Excel's giant hidden HTML copy, which can crash the tab). Read text/plain
  // ourselves instead.
  function onPasteKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "v" || e.key === "V") && canReadClip()) {
      LOG("bp ctrl+v keydown");           // synchronous in the keydown gesture — persists
      e.preventDefault();
      _pasteViaKey = Date.now();
      loadFromClipboard();
    }
  }

  function onInputPaste(e) {
    if (Date.now() - _pasteViaKey < 800) return;  // already handled at keydown
    LOG("bp paste:event");                      // logged before reading the clipboard
    const cd = e.clipboardData || window.clipboardData;
    if (!cd) { setTimeout(loadFromTextarea, 0); return; }
    const text = cd.getData("text");
    if (!text) return;
    e.preventDefault();
    LOG("bp paste", { chars: text.length });   // synchronous (user gesture) → persists even if the next step crashes
    if (text.length > MAX_INPUT_CHARS) {
      setStatus(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars — likely a whole-column copy). Trim the selection.`, "error");
      return;
    }
    const ta = $("#bp-input");
    const hasSel = typeof ta.selectionStart === "number";
    const s = hasSel ? ta.selectionStart : ta.value.length;
    const en = hasSel ? ta.selectionEnd : ta.value.length;
    const combined = (_summaryText && ta.value === _summaryText) ? text : ta.value.slice(0, s) + text + ta.value.slice(en);
    setBusy(true);
    deferHeavy(() => doLoad(combined));   // doLoad sets the textarea (raw or summary)
  }

  function doLoad(text) {
    LOG("bp doLoad start", { chars: text.length });
    try {
      // Guard against pathologically large pastes — building string + numeric
      // matrices for tens of millions of cells can exhaust the tab's memory and
      // crash the browser. Fail clearly instead.
      if (text.length > MAX_INPUT_CHARS) {
        throw new Error(`Too large to load safely (${(text.length / 1e6).toFixed(1)}M chars). Trim the data.`);
      }
      // Pre-flight size check BEFORE parseTable allocates the cell matrix — a
      // huge paste can OOM-crash the tab during parsing, before any post-parse
      // guard runs.
      const est = P.estimateCells(text);
      LOG("bp preflight", est);
      if (est.cells > MAX_CELLS) {
        throw new Error(`Too large (~${est.rows}×${est.cols} ≈ ${(est.cells / 1e6).toFixed(1)}M cells); limit ${MAX_CELLS / 1e6}M.`);
      }
      // Free the previous dataset before allocating the new one.
      _data = null; _boxCache = null;
      const rows = P.parseTable(text);
      if (!rows.length) throw new Error("empty");
      let ncols0 = 0;
      for (let i = 0; i < rows.length; i++) if (rows[i].length > ncols0) ncols0 = rows[i].length;
      LOG("bp parsed", { rows: rows.length, cols: ncols0, cells: rows.length * ncols0 });
      if (rows.length * ncols0 > MAX_CELLS) {
        throw new Error(`Too many cells (${rows.length}×${ncols0}); limit ~${(MAX_CELLS / 1e6)}M to avoid running out of memory.`);
      }
      let headers, body;
      const firstAllNum = rows[0].every((c) => String(c).trim() !== "" && Number.isFinite(Number(c)));
      if (!firstAllNum) { headers = rows[0].map((c) => String(c).trim()); body = rows.slice(1); }
      else { headers = rows[0].map((_, i) => `C${i + 1}`); body = rows; }
      headers = dedupeHeaders(headers);
      const col = {};
      headers.forEach((h) => (col[h] = { raw: [], num: null, isPercent: false }));
      for (const r of body) {
        for (let j = 0; j < headers.length; j++) col[headers[j]].raw.push(j < r.length ? String(r[j]).trim() : "");
      }
      headers.forEach((h) => {
        const c = col[h];
        const firstNonEmpty = c.raw.find((v) => v !== "");
        c.isPercent = !!(firstNonEmpty && firstNonEmpty.endsWith("%"));
        // Float64Array keeps the numeric copy compact (vs a boxed JS array).
        c.num = Float64Array.from(c.raw, (v) => { if (v === "") return NaN; const s = c.isPercent ? v.replace(/%\s*$/, "") : v; const n = Number(s); return Number.isFinite(n) ? n : NaN; });
      });
      _data = { headers, nrows: body.length, col };
      _dataVersion++;
      _boxCache = null;
      const nc = numericCols();
      // Nothing is selected on load — pick columns/groups in the Columns
      // section. (Avoids drawing a huge auto-selection the moment data loads.)
      _wideSel = new Set();
      LOG("bp columns built", { numericCols: nc.length });
      populateColumns();
      LOG("bp populateColumns done");
      updateModeUI();
      render();
      LOG("bp render done");
      summarizeInput(text, body.length, headers.length);
      setStatus(`Loaded ${body.length} rows × ${headers.length} columns. Pick columns / group in the Columns section.`);
    } catch (e) {
      LOG("bp doLoad ERROR", String(e && e.message || e));
      setStatus("Parse error: " + (e.message || e), "error");
    }
  }

  function numericCols() {
    return _data ? _data.headers.filter((h) => _data.col[h].num.some(Number.isFinite)) : [];
  }

  function populateColumns() {
    // Wide column toggle list
    const host = $("#bp-wide-cols");
    host.innerHTML = "";
    numericCols().forEach((name) => {
      const item = el("div", { class: "collist-item" + (_wideSel.has(name) ? " selected" : "") }, name);
      item.addEventListener("click", () => {
        if (_wideSel.has(name)) _wideSel.delete(name); else _wideSel.add(name);
        item.classList.toggle("selected");
        render();
      });
      host.appendChild(item);
    });
    // Long selects
    const numOpts = numericCols().map((h) => [h, h]);
    const allOpts = _data.headers.map((h) => [h, h]);
    fillSelect("bp-long-val", numOpts);
    fillSelect("bp-long-group", allOpts);
    fillSelect("bp-long-ref", [["", "(none)"]].concat(allOpts));
  }
  function fillSelect(id, opts) {
    const s = $("#" + id); const prev = s.value;
    s.innerHTML = "";
    opts.forEach(([v, l]) => s.appendChild(el("option", { value: v }, l)));
    if (opts.some(([v]) => v === prev)) s.value = prev;
  }

  function updateModeUI() {
    const long = ($$('input[name="bp-mode"]').find((r) => r.checked) || {}).value === "long";
    $("#bp-wide-wrap").style.display = long ? "none" : "";
    $("#bp-long-wrap").style.display = long ? "" : "none";
  }

  function reset() {
    _data = null; _wideSel = new Set(); _summaryText = null;
    $("#bp-input").value = "";
    $("#bp-wide-cols").innerHTML = "";
    $("#bp-stats-host").innerHTML = "";
    clearCanvas();
    $("#bp-info").textContent = "";
    setStatus("Boxplot cleared.");
  }

  // ---------- box data ----------
  function orderedUnique(arr) {
    const seen = new Set(); const out = [];
    for (const v of arr) { if (!seen.has(v)) { seen.add(v); out.push(v); } }
    const allNum = out.every((v) => v !== "" && Number.isFinite(Number(v)));
    if (allNum) out.sort((a, b) => Number(a) - Number(b));
    else out.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    return out;
  }

  function boxColor(i) {
    if ($("#bp-color-seq").checked) {
      const pal = window.LUMOS_config.load().priority_colors || window.LUMOS_config.DEFAULT_PRIORITY_COLORS;
      return pal[i % pal.length];
    }
    return $("#bp-box-color").value || "#ADD8E6";
  }

  function fullStat(values) {
    const s = N.boxplotStats(values);
    if (!s) return null;
    const st = N.stats(values);
    return Object.assign({}, s, { std: st.std, unif: st.unif });
  }

  // Build the box structure + per-group stats (no colours — those depend on
  // live style). Heavy work (grouping + sort) lives here; cached by data /
  // mode / column selection so style tweaks don't recompute it.
  function computeBoxRaw() {
    const longMode = ($$('input[name="bp-mode"]').find((r) => r.checked) || {}).value === "long";
    const cfg = window.LUMOS_config.load();
    if (!longMode) {
      const sel = _data.headers.filter((h) => _wideSel.has(h));
      const items = sel.map((name) => {
        const values = _data.col[name].num.filter(Number.isFinite);
        return { label: name, values, full: fullStat(values) };
      }).filter((it) => it.values.length);
      return { kind: "simple", xLabels: items.map((i) => i.label), items,
        percent: sel.length > 0 && sel.every((c) => _data.col[c].isPercent) };
    }
    const valCol = $("#bp-long-val").value, grpCol = $("#bp-long-group").value, refCol = $("#bp-long-ref").value;
    if (!valCol || !grpCol) throw new Error("Pick a Value and a Group column.");
    const vNum = _data.col[valCol].num, gRaw = _data.col[grpCol].raw;
    const rRaw = refCol ? _data.col[refCol].raw : null;
    const gVals = [], rVals = [], vVals = [];
    for (let i = 0; i < _data.nrows; i++) {
      const v = vNum[i];
      if (!Number.isFinite(v)) continue;
      gVals.push(gRaw[i]); vVals.push(v); if (rRaw) rVals.push(rRaw[i]);
    }
    const groups = orderedUnique(gVals);
    if (groups.length > MAX_X_GROUPS) throw new Error(`Too many X groups (${groups.length} > ${MAX_X_GROUPS}).`);
    const percent = _data.col[valCol].isPercent;
    if (!refCol) {
      const map = new Map(groups.map((g) => [g, []]));
      for (let i = 0; i < vVals.length; i++) map.get(gVals[i]).push(vVals[i]);
      const items = groups.map((g) => ({ label: String(g), values: map.get(g), full: fullStat(map.get(g)) }));
      return { kind: "simple", xLabels: groups.map(String), items, percent };
    }
    const refs = orderedUnique(rVals);
    if (refs.length > MAX_REF_GROUPS) throw new Error(`Too many split groups (${refs.length} > ${MAX_REF_GROUPS}).`);
    const cells = new Map();
    groups.forEach((g) => { const m = new Map(); refs.forEach((r) => m.set(r, [])); cells.set(g, m); });
    for (let i = 0; i < vVals.length; i++) cells.get(gVals[i]).get(rVals[i]).push(vVals[i]);
    cells.forEach((m) => m.forEach((arr, r) => m.set(r, { values: arr, full: fullStat(arr) })));
    const boxPal = cfg.boxplot_colors || ["#377eb8", "#ff7f00", "#4daf4a", "#f781bf", "#a65628", "#984ea3"];
    const legend = refs.map((r, j) => ({ label: String(r), color: boxPal[j % boxPal.length] }));
    return { kind: "grouped", xLabels: groups.map(String), groups, refs, cells, legend, percent };
  }

  function getBoxData() {
    const longMode = ($$('input[name="bp-mode"]').find((r) => r.checked) || {}).value === "long";
    const key = JSON.stringify([_dataVersion, longMode, longMode
      ? [$("#bp-long-val").value, $("#bp-long-group").value, $("#bp-long-ref").value]
      : _data.headers.filter((h) => _wideSel.has(h))]);
    if (_boxCache && _boxCache.key === key) return _boxCache.data;
    const data = computeBoxRaw();
    _boxCache = { key, data };
    return data;
  }

  // ---------- rendering ----------
  function clearCanvas() {
    const host = $("#bp-plots"); if (host) host.innerHTML = "";
  }

  function safeName(s) { return String(s).replace(/[^\w.-]+/g, "_").slice(0, 40) || "plot"; }

  function copyCanvas(canvas) {
    if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") { setStatus("Image clipboard copy isn't supported in this browser.", "warn"); return; }
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try { await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]); setStatus("Plot copied to clipboard."); }
      catch (e) { setStatus("Copy failed (needs HTTPS / clipboard permission).", "error"); }
    }, "image/png");
  }

  // Make one bordered plot cell (canvas + Copy / Save tools) and return its ctx.
  function addPlotCell(host, w, h, filename) {
    const cell = el("div", { class: "dp-plot-cell" });
    const canvas = el("canvas", {});
    cell.appendChild(canvas);
    const copyBtn = el("button", {}, "Copy");
    copyBtn.addEventListener("click", () => copyCanvas(canvas));
    const saveBtn = el("button", {}, "Save");
    saveBtn.addEventListener("click", () => U.downloadCanvasPNG(canvas, filename));
    cell.appendChild(el("div", { class: "dp-plot-tools" }, [copyBtn, saveBtn]));
    host.appendChild(cell);
    const ctx = PL.fitCanvas(canvas, w, h);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    return ctx;
  }

  function render() {
    if (!_data) return;
    _persist();
    renderStats();
    if (activePane() === "plot") renderPlot();
  }

  // Transform a precomputed raw stat for drawing (whisker mode + log).
  function transformStat(s, showOutliers, log) {
    if (!s) return null;
    let wl = s.whiskerLow, wh = s.whiskerHigh, outs = s.outliers;
    if (!showOutliers) { wl = s.min; wh = s.max; outs = []; }
    const tf = log ? Math.log10 : (x) => x;
    return { q1: tf(s.q1), q2: tf(s.q2), q3: tf(s.q3), whiskerLow: tf(wl), whiskerHigh: tf(wh), mean: tf(s.mean), outliers: outs.map(tf) };
  }

  // Evenly subsample an array down to `cap` items (keeps jitter cheap on huge
  // groups without changing the box statistics).
  function subsample(arr, cap) {
    if (arr.length <= cap) return arr;
    const out = new Array(cap);
    const step = arr.length / cap;
    for (let i = 0; i < cap; i++) out[i] = arr[Math.floor(i * step)];
    return out;
  }

  function renderPlot() {
    if (!_data) return;
    let data;
    try { data = getBoxData(); } catch (e) { clearCanvas(); setStatus(e.message || String(e), "warn"); return; }
    const nSlots = data.kind === "simple" ? data.items.length : data.groups.length;
    if (!nSlots) { clearCanvas(); setStatus("Select at least one column / group.", "warn"); return; }

    // y-range from precomputed per-box extremes — avoids re-scanning every
    // value on each render and the call-stack blowup of Math.min(...hugeArray).
    let gMin = Infinity, gMax = -Infinity;
    eachStat(data, (_lab, s) => { if (s.min < gMin) gMin = s.min; if (s.max > gMax) gMax = s.max; });
    if (!Number.isFinite(gMin)) { clearCanvas(); setStatus("No numeric values.", "warn"); return; }

    const log = $("#bp-log").checked;
    if (log && gMin <= 0) { clearCanvas(); setStatus("Log Y needs all values > 0.", "warn"); return; }
    let yMin = log ? Math.log10(gMin) : gMin;
    let yMax = log ? Math.log10(gMax) : gMax;
    const pad = (yMax - yMin) * 0.05 || 0.5;
    yMin -= pad; yMax += pad;
    const ymanMin = parseFinite($("#bp-ymin").value), ymanMax = parseFinite($("#bp-ymax").value);
    if (ymanMin != null) { const v = log ? (ymanMin > 0 ? Math.log10(ymanMin) : yMin) : ymanMin; yMin = v; }
    if (ymanMax != null) { const v = log ? (ymanMax > 0 ? Math.log10(ymanMax) : yMax) : ymanMax; yMax = v; }

    const showJ = $("#bp-jitter").checked, showM = $("#bp-mean").checked, showO = $("#bp-outliers").checked;
    const boxW = Number($("#bp-box-width").value) || 0.6;
    const tickFont = $("#bp-tick-font").value, tickSize = Number($("#bp-tick-size").value) || 11, tickBold = $("#bp-tick-bold").checked;
    const labelFont = $("#bp-label-font").value, labelSize = Number($("#bp-label-size").value) || 13, labelBold = $("#bp-label-bold").checked;
    const frameLW = Number($("#bp-frame-lw").value) || 1;
    const showGrid = $("#bp-grid").checked;
    const xlabel = $("#bp-xlabel").value, ylabel = $("#bp-ylabel").value;
    let xrot = $("#bp-xlabel-rot").value || "auto";
    if (xrot === "auto") xrot = nSlots > 5 ? "diagonal" : "horizontal";

    const splitLayout = ($("#bp-split-layout") || {}).value || "side";
    const grouped = data.kind === "grouped";
    const subplotMode = grouped && splitLayout === "subplot";

    // Panel size: explicit Canvas W/H if set, else fill the area (single panel)
    // or a fixed default for subplots so each tile keeps a usable size.
    const cwIn = parseFinite($("#bp-canvas-w").value), chIn = parseFinite($("#bp-canvas-h").value);
    const area = $("#bp-plot-area");
    const panelW = cwIn != null ? Math.max(120, cwIn) : (subplotMode ? SUB_DEFAULT_W : (area.clientWidth || 680) - 8);
    const panelH = chIn != null ? Math.max(120, chIn) : (subplotMode ? SUB_DEFAULT_H : (area.clientHeight || 520) - 8);

    const drawOpts = { showJ, showM, showO, log };
    const S = {
      yMin, yMax, log, tickFont, tickSize, tickBold,
      labelFont, labelSize, labelBold, frameLW, showGrid, xrot, xlabel, ylabel,
      legendFont: $("#bp-legend-font").value,
      legendSize: Number($("#bp-legend-size").value) || 11,
      legendLoc: $("#bp-legend-loc").value || "upper right",
    };

    const host = $("#bp-plots");
    host.innerHTML = "";
    if (subplotMode) {
      // One bordered cell per box-split value, tiled on an N-column grid (cols
      // set in Style); each cell is its own copy-/save-able plot.
      const ncol = Math.max(1, Math.min(Number($("#bp-subplot-cols").value) || 2, data.refs.length));
      host.style.gridTemplateColumns = `repeat(${ncol}, ${panelW}px)`;
      data.refs.forEach((r, k) => {
        const ctx = addPlotCell(host, panelW, panelH, `boxplot_${safeName(r)}.png`);
        drawBoxPanel(ctx, { x: 0, y: 0, w: panelW, h: panelH }, {
          xLabels: data.groups.map(String),
          nSlots: data.groups.length,
          title: String(r),
          showXLabel: true,
          showYLabel: true,
          padRight: 12,
          drawBoxes(c, T) {
            data.groups.forEach((g, i) => {
              const cell = data.cells.get(g).get(r);
              if (!cell.values.length) return;
              drawOneBox(c, T, i + 0.5, boxW / 2, cell.values, cell.full, data.legend[k].color, drawOpts);
            });
          },
        }, S);
      });
    } else {
      host.style.gridTemplateColumns = `repeat(1, ${panelW}px)`;
      const ctx = addPlotCell(host, panelW, panelH, "boxplot.png");
      drawBoxPanel(ctx, { x: 0, y: 0, w: panelW, h: panelH }, {
        xLabels: data.xLabels,
        nSlots,
        showXLabel: true,
        showYLabel: true,
        padRight: 18,
        legend: grouped ? data.legend : null,
        drawBoxes(c, T) {
          if (data.kind === "simple") {
            data.items.forEach((it, i) => drawOneBox(c, T, i + 0.5, boxW / 2, it.values, it.full, boxColor(i), drawOpts));
          } else {
            const nRef = data.refs.length, subW = boxW / nRef;
            data.groups.forEach((g, i) => data.refs.forEach((r, j) => {
              const cell = data.cells.get(g).get(r);
              if (!cell.values.length) return;
              const cx = (i + 0.5) - boxW / 2 + subW * (j + 0.5);
              drawOneBox(c, T, cx, (subW / 2) * 0.82, cell.values, cell.full, data.legend[j].color, drawOpts);
            }));
          }
        },
      }, S);
    }

    $("#bp-info").textContent = grouped
      ? `${data.groups.length} groups × ${data.refs.length}${subplotMode ? " (subplots)" : ""}`
      : `${nSlots} boxes`;
  }

  // Draw one boxplot panel into `rect`. `panel.drawBoxes(ctx, T)` paints the
  // boxes; the rest (frame, ticks, labels, optional title + inside legend) is
  // shared so single-axis and subplot layouts render identically.
  function drawBoxPanel(ctx, rect, panel, S) {
    const { xLabels, nSlots, title } = panel;
    ctx.font = `${S.tickBold ? "bold " : ""}${S.tickSize}px ${S.tickFont}`;
    let maxLabelW = 0;
    for (const lab of xLabels) maxLabelW = Math.max(maxLabelW, ctx.measureText(String(lab)).width);
    let xLabelSpace;
    if (S.xrot === "vertical") xLabelSpace = Math.min(maxLabelW + 14, 170);
    else if (S.xrot === "diagonal") xLabelSpace = Math.min(maxLabelW * 0.72 + 16, 130);
    else xLabelSpace = S.tickSize + 16;

    const padLeft = 18 + Math.round(S.tickSize * 3.2);
    const padTop = 14 + (title ? S.labelSize + 8 : 0);
    const padBottom = xLabelSpace + 10 + (panel.showXLabel && S.xlabel ? S.labelSize + 6 : 0);
    const padRight = panel.padRight != null ? panel.padRight : 18;
    const box = PL.plotBox(rect, { padLeft, padRight, padTop, padBottom });
    const T = PL.makeTransform(box, [0, nSlots], [S.yMin, S.yMax]);

    ctx.save();
    ctx.strokeStyle = "#444"; ctx.lineWidth = S.frameLW;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
    const yTicks = PL.makeTicks(S.yMin, S.yMax, 7);
    ctx.font = `${S.tickBold ? "bold " : ""}${S.tickSize}px ${S.tickFont}`;
    ctx.fillStyle = "#222"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const tv of yTicks) {
      const { y } = T.toPx(0, tv);
      if (S.showGrid) { ctx.strokeStyle = "rgba(0,0,0,0.08)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke(); }
      ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x - 4, y); ctx.stroke();
      ctx.fillText(U.fmtTick(S.log ? Math.pow(10, tv) : tv), box.x - 6, y);
    }
    // x labels
    ctx.font = `${S.tickBold ? "bold " : ""}${S.tickSize}px ${S.tickFont}`;
    ctx.fillStyle = "#222";
    xLabels.forEach((lab, i) => {
      const { x } = T.toPx(i + 0.5, S.yMin);
      const ly = box.y + box.h + 6;
      if (S.xrot === "diagonal") { ctx.save(); ctx.translate(x, ly); ctx.rotate(-Math.PI / 4); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(lab, 0, 0); ctx.restore(); }
      else if (S.xrot === "vertical") { ctx.save(); ctx.translate(x, ly); ctx.rotate(-Math.PI / 2); ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(lab, 0, 0); ctx.restore(); }
      else { ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(lab, x, ly); }
    });
    const labelFontStr = `${S.labelBold ? "bold " : ""}${S.labelSize}px ${S.labelFont}`;
    if (title) { ctx.font = labelFontStr; ctx.fillStyle = "#222"; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(String(title), box.x + box.w / 2, rect.y + 4); }
    if (panel.showXLabel && S.xlabel) { ctx.font = labelFontStr; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(S.xlabel, box.x + box.w / 2, rect.y + rect.h - 4); }
    if (panel.showYLabel && S.ylabel) { ctx.save(); ctx.translate(rect.x + 12, box.y + box.h / 2); ctx.rotate(-Math.PI / 2); ctx.font = labelFontStr; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(S.ylabel, 0, 0); ctx.restore(); }
    ctx.restore();

    // boxes (clipped to plot area)
    ctx.save();
    ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
    panel.drawBoxes(ctx, T);
    ctx.restore();

    if (panel.legend && panel.legend.length) drawLegendInside(ctx, box, panel.legend, S.legendFont, S.legendSize, S.legendLoc);
  }

  function drawOneBox(ctx, T, cx, halfW, values, full, color, o) {
    const st = transformStat(full, o.showO, o.log);
    if (!st) return;
    PL.drawBox(ctx, T, cx, halfW, st, color);
    if (o.showJ) {
      let jv = subsample(values, JITTER_CAP);
      if (o.log) jv = jv.map(Math.log10);
      PL.drawJitter(ctx, T, cx, halfW, jv, color);
    }
    if (o.showM) PL.drawMeanMarker(ctx, T, cx, halfW, st.mean, color);
    if (o.showO) PL.drawOutliers(ctx, T, cx, st.outliers, color);
  }

  // Legend drawn inside the plot box at one of the four corners, over a
  // translucent backing so it stays readable on top of the boxes.
  function drawLegendInside(ctx, box, entries, font, size, loc) {
    const sq = Math.max(10, size + 2), gap = 4, pad = 7, margin = 8;
    ctx.save();
    ctx.font = `${size}px ${font}`;
    let maxW = 0;
    for (const e of entries) maxW = Math.max(maxW, ctx.measureText(e.label).width);
    const blockW = pad * 2 + sq + 6 + maxW;
    const blockH = pad * 2 + entries.length * (sq + gap) - gap;
    let x = box.x + margin, y = box.y + margin;
    if (String(loc).indexOf("right") >= 0) x = box.x + box.w - blockW - margin;
    if (String(loc).indexOf("lower") >= 0) y = box.y + box.h - blockH - margin;
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.fillRect(x, y, blockW, blockH);
    ctx.strokeStyle = "#bbb"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, blockW, blockH);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    entries.forEach((e, i) => {
      const by = y + pad + i * (sq + gap);
      ctx.fillStyle = e.color; ctx.fillRect(x + pad, by, sq, sq);
      ctx.strokeStyle = "#444"; ctx.lineWidth = 1; ctx.strokeRect(x + pad + 0.5, by + 0.5, sq, sq);
      ctx.fillStyle = "#222"; ctx.fillText(e.label, x + pad + sq + 6, by + sq / 2);
    });
    ctx.restore();
  }

  function parseFinite(s) { s = (s || "").trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

  function eachStat(data, fn) {
    if (data.kind === "simple") data.items.forEach((it) => { if (it.full) fn(it.label, it.full); });
    else data.groups.forEach((g) => data.refs.forEach((r) => { const c = data.cells.get(g).get(r); if (c.full) fn(`${g} / ${r}`, c.full); }));
  }

  function renderStats() {
    if (!_data) return;
    let data;
    try { data = getBoxData(); } catch (e) { return; }
    const host = $("#bp-stats-host");
    if (!host) return;
    host.innerHTML = "";
    const table = el("table", { class: "data-table" });
    table.appendChild(el("thead", {}, [el("tr", {}, ["Group", "N", "Mean", "Median", "Q1", "Q3", "Min", "Max", "Std", "Unif%"].map((hh) => el("th", {}, hh)))]));
    const tbody = el("tbody");
    eachStat(data, (label, s) => {
      const tr = el("tr");
      tr.appendChild(el("td", {}, label));
      [s.n, s.mean, s.q2, s.q1, s.q3, s.min, s.max, s.std, s.unif].forEach((v) => tr.appendChild(el("td", {}, Number.isFinite(v) ? U.fmt(v, 6) : "—")));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function copyStats() {
    if (!_data) return;
    let data; try { data = getBoxData(); } catch (e) { return; }
    const headers = ["Group", "N", "Mean", "Median", "Q1", "Q3", "Min", "Max", "Std", "Unif%"];
    const lines = [headers.join("\t")];
    eachStat(data, (label, s) => {
      lines.push([label, s.n, s.mean, s.q2, s.q1, s.q3, s.min, s.max, s.std, s.unif]
        .map((v) => typeof v === "string" ? v : (Number.isFinite(v) ? U.fmt(v, 6) : "")).join("\t"));
    });
    U.copyToClipboard(lines.join("\n")).then((ok) => setStatus(ok ? "Stats copied." : "Copy failed.", ok ? "" : "warn"));
  }

  // ---------- events ----------
  function onDocPaste(e) {
    const tab = $("section.tab-panel.active");
    if (!tab || tab.dataset.tab !== "boxplot") return;
    if (e.target && e.target.id === "bp-input") return;
    const cd = e.clipboardData || window.clipboardData;
    const text = cd ? cd.getData("text") : "";
    if (!text) return;
    e.preventDefault();
    setBusy(true);
    deferHeavy(() => { $("#bp-input").value = text; doLoad(text); });
  }

  const STYLE_IDS = [
    "bp-box-width", "bp-box-color", "bp-color-seq", "bp-jitter", "bp-mean", "bp-outliers",
    "bp-log", "bp-grid", "bp-tick-font", "bp-tick-size", "bp-tick-bold", "bp-xlabel-rot",
    "bp-label-font", "bp-label-size", "bp-label-bold", "bp-frame-lw", "bp-xlabel", "bp-ylabel",
    "bp-split-layout", "bp-legend-loc", "bp-legend-font", "bp-legend-size",
    "bp-canvas-w", "bp-canvas-h", "bp-subplot-cols", "bp-ymin", "bp-ymax",
    "bp-long-val", "bp-long-group", "bp-long-ref",
  ];

  function bindEvents() {
    $("#bp-load").addEventListener("click", loadFromTextarea);
    $("#bp-clip").addEventListener("click", loadFromClipboard);
    $("#bp-reset").addEventListener("click", reset);
    $("#bp-input").addEventListener("paste", onInputPaste);
    $("#bp-copy-stats").addEventListener("click", copyStats);
    $$("#bp-tabs li").forEach((li) => li.addEventListener("click", () => showPane(li.getAttribute("data-pane"))));
    $$('input[name="bp-mode"]').forEach((r) => r.addEventListener("change", () => { updateModeUI(); render(); }));

    const onChange = () => { if (_data) render(); else _persist(); };
    STYLE_IDS.forEach((id) => { const e = $("#" + id); if (!e) return; e.addEventListener("change", onChange); e.addEventListener("input", onChange); });

    document.addEventListener("paste", onDocPaste);
  }

  function init(root) {
    buildUI(root);
    _persist = U.debounce(persistSettings, 300);
    restoreSettings();
    updateModeUI();
    bindEvents();
    window.addEventListener("resize", U.debounce(() => { if (_data && activePane() === "plot") renderPlot(); }, 150));
  }

  function onShow() { if (_data && activePane() === "plot") window.requestAnimationFrame(renderPlot); }
  function onSettingsChanged() { if (_data) render(); }

  window.LUMOS_tab_boxplot = { init, onShow, onSettingsChanged, loadFromClipboard };
})();

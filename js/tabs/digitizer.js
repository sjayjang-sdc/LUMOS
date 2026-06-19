// Digitizer tab — pixel-to-data extraction.
//   * Load image (file picker, drag-drop, Ctrl+V)
//   * 2X + 2Y calibration via click + drag markers
//   * Levels, grid removal, color picker
//   * Brush + eraser to constrain the extraction region
//   * Output: line trace (median y per x) or symbol centroids
"use strict";

(function () {
  const U = window.LUMOS_util;
  const N = window.LUMOS_numerics;
  const IP = window.LUMOS_imageproc;

  // ---------- State ----------
  const MODE_NONE = null;
  const MODE_PICK_X = "pick_x";
  const MODE_PICK_Y = "pick_y";
  const MODE_BRUSH = "brush";
  const MODE_ERASER = "eraser";
  const MODE_PICK_COLOR = "pick_color";

  const SLOTS = [
    { axis: "x", label: "X #1", color: "#d62728", marker: "+" },
    { axis: "x", label: "X #2", color: "#d62728", marker: "+" },
    { axis: "y", label: "Y #1", color: "#2ca02c", marker: "x" },
    { axis: "y", label: "Y #2", color: "#2ca02c", marker: "x" },
  ];

  let _state = null;
  let _persist = null;

  // Persisted controls → digitizer_settings keys. Calibration (picks / log /
  // table), the brush mask, target colour and zoom are intentionally NOT
  // persisted — they belong to a specific image. group "prep" = the Preprocess
  // section (reset by the Defaults button).
  const PERSIST = [
    ["dg-auto-invert", "auto_invert", "check", "prep"],
    ["dg-lv-black", "levels_black", "num", "prep"],
    ["dg-lv-white", "levels_white", "num", "prep"],
    ["dg-lv-gamma", "levels_gamma", "num", "prep"],
    ["dg-remove-grid", "remove_grid", "check", "prep"],
    ["dg-grid-len", "grid_line_length", "num", "prep"],
    ["dg-grid-thick", "grid_thickness", "num", "prep"],
    ["dg-grid-thresh", "grid_threshold", "num", "prep"],
    ["dg-color-tol", "color_tolerance", "num", "prep"],
    ["dg-band", "band_width", "num", "prep"],
    ["dg-keep-largest", "keep_largest", "check", "prep"],
    ["dg-output-mode", "output_mode", "value", "prep"],
    ["dg-point-step", "point_step", "num", "prep"],
    ["dg-min-area", "min_symbol_area", "num", "prep"],
    ["dg-split-symbols", "split_symbols", "check", "prep"],
    ["dg-symbol-size", "symbol_size", "num", "prep"],
    ["dg-brush-r", "brush_radius", "num", "region"],
    ["dg-ov-color", "overlay_color", "value", "result"],
    ["dg-ov-linew", "overlay_line_width", "num", "result"],
    ["dg-ov-symsize", "overlay_marker_size", "num", "result"],
  ];

  function freshState() {
    return {
      rgba: null, gray: null, width: 0, height: 0,
      sourceName: "<none>",
      cal: SLOTS.map((s) => ({ ...s, data: null, px: null, py: null })),
      mode: MODE_NONE,
      dragIdx: null,
      brushMask: null,
      brushPainting: false,
      roiRect: null,
      targetColor: null,
      preview: null,  // cached preview image (grayscale processed)
      previewDirty: true,
      result: [],
      resultMode: "line", // mode used for the current result ("line" | "symbols")
      view: "Original",  // "Original" | "Preprocessed" | "Grid"
      zoom: 1,           // canvas zoom multiplier (1 = fit-to-area)
    };
  }

  // ---------- element helpers ----------
  const el = U.el, $ = U.$, $$ = U.$$;
  function block(title, children) { return el("div", { class: "dp-block" }, [el("h4", {}, title)].concat(children)); }
  function prefRow(label, input) { return el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, label), input]); }
  function numEl(id, val, a) { const e = el("input", { type: "number", id, value: String(val) }); a = a || {}; ["min", "max", "step"].forEach((k) => { if (a[k] != null) e.setAttribute(k, a[k]); }); return e; }
  function chk(id, checked, label) { const i = checked ? el("input", { type: "checkbox", id, checked: true }) : el("input", { type: "checkbox", id }); return el("label", { class: "dg-chk" }, [i, " " + label]); }
  function selectEl(id, opts) { const s = el("select", { id }); opts.forEach(([v, l]) => s.appendChild(el("option", { value: v }, l))); return s; }
  function viewRadio(v, label, checked) { const i = checked ? el("input", { type: "radio", name: "dg-view", value: v, checked: true }) : el("input", { type: "radio", name: "dg-view", value: v }); return el("label", { class: "dg-seg-item" }, [i, " " + label]); }

  function buildUI(root) {
    root.innerHTML = "";
    const layout = el("div", { class: "dp-layout" });
    root.appendChild(layout);

    // Column 1: section nav
    const nav = el("ul", { class: "dp-nav", id: "dg-nav" });
    [["image", "Image"], ["cal", "Calibration"], ["prep", "Preprocess"], ["region", "Region"], ["result", "Result"]].forEach(([id, label], i) => {
      const li = el("li", { "data-sec": id, class: i === 0 ? "active" : "" }, label);
      li.addEventListener("click", () => showSection(id));
      nav.appendChild(li);
    });
    layout.appendChild(nav);

    // Column 2: scrollable sections + a pinned Extract button at the bottom.
    const col2 = el("div", { class: "dg-col2" });
    layout.appendChild(col2);
    const sections = el("div", { class: "dp-sections", id: "dg-sections" });
    col2.appendChild(sections);
    col2.appendChild(el("button", { id: "dg-extract", class: "primary" }, "Extract Data"));

    sections.appendChild(el("div", { class: "dp-section active", "data-sec": "image" }, [
      block("Source", [
        el("div", { class: "row" }, [
          el("button", { id: "dg-load", class: "primary" }, "Load image…"),
          el("button", { id: "dg-paste" }, "Paste (Ctrl+V)"),
        ]),
        el("div", { id: "dg-filename", class: "hint" }, "<no image>"),
        el("input", { type: "file", id: "dg-file", accept: "image/*", style: "display:none" }),
        el("div", { class: "pref-hint" }, "Drag & drop a file onto the canvas, or press Ctrl+V."),
      ]),
    ]));

    const calRows = SLOTS.map((s, i) => el("tr", {}, [
      el("td", {}, s.label),
      el("td", {}, el("input", { type: "text", "data-idx": i, "data-field": "data", placeholder: "value", style: "width:84px" })),
      el("td", {}, el("input", { type: "number", "data-idx": i, "data-field": "px", style: "width:62px", step: "any" })),
      el("td", {}, el("input", { type: "number", "data-idx": i, "data-field": "py", style: "width:62px", step: "any" })),
    ]));
    sections.appendChild(el("div", { class: "dp-section", "data-sec": "cal" }, [
      block("Pick points", [
        el("div", { class: "pref-hint" }, "Click two X-axis ticks, then two Y-axis ticks. Drag markers to fine-tune."),
        el("div", { class: "row" }, [
          el("button", { id: "dg-pick-x", class: "toggle" }, "Pick X"),
          el("button", { id: "dg-pick-y", class: "toggle" }, "Pick Y"),
        ]),
        el("div", { class: "row" }, [
          el("label", { class: "dg-chk" }, [el("input", { type: "checkbox", id: "dg-log-x" }), " Log X"]),
          el("label", { class: "dg-chk" }, [el("input", { type: "checkbox", id: "dg-log-y" }), " Log Y"]),
        ]),
      ]),
      block("Values & pixels", [
        el("table", { class: "data-table", id: "dg-cal-table", style: "width:100%" }, [
          el("thead", {}, el("tr", {}, ["Axis", "Value", "Px X", "Px Y"].map((h) => el("th", {}, h)))),
          el("tbody", {}, calRows),
        ]),
        el("div", { class: "row" }, [
          el("button", { id: "dg-clear-x" }, "Clear X"),
          el("button", { id: "dg-clear-y" }, "Clear Y"),
          el("button", { id: "dg-reset-cal" }, "Reset all"),
        ]),
      ]),
    ]));

    sections.appendChild(el("div", { class: "dp-section", "data-sec": "prep" }, [
      block("Levels", [
        chk("dg-auto-invert", false, "Auto-invert if dark background"),
        prefRow("Black", numEl("dg-lv-black", 0, { min: 0, max: 200, step: 5 })),
        prefRow("White", numEl("dg-lv-white", 255, { min: 20, max: 255, step: 5 })),
        prefRow("Gamma", numEl("dg-lv-gamma", 1.0, { min: 0.1, max: 5.0, step: 0.1 })),
        el("div", { class: "row" }, [el("button", { id: "dg-lv-reset" }, "Reset levels")]),
        el("div", { class: "pref-hint" }, "Pull White down to fade faint grids while keeping data dark."),
      ]),
      block("Grid removal", [
        chk("dg-remove-grid", true, "Remove grid lines"),
        prefRow("Min length", numEl("dg-grid-len", 20, { min: 3, max: 200 })),
        prefRow("Thickness", numEl("dg-grid-thick", 2, { min: 1, max: 10 })),
        prefRow("Threshold", numEl("dg-grid-thresh", 0, { min: 0, max: 255, step: 5 })),
        el("div", { class: "pref-hint" }, "Threshold 0 = auto (Otsu)."),
      ]),
      block("Line detection", [
        el("div", { class: "row" }, [
          el("button", { id: "dg-pick-color", class: "toggle" }, "Pick line color"),
          el("span", { id: "dg-color-swatch", style: "border:1px solid #888; padding:2px 8px; min-width:58px; display:inline-block; text-align:center;" }, "(none)"),
          el("button", { id: "dg-clear-color" }, "Clear"),
        ]),
        prefRow("Color tol", numEl("dg-color-tol", 30, { min: 1, max: 200, step: 5 })),
        prefRow("Band width", numEl("dg-band", 6, { min: 2, max: 60 })),
        el("div", { class: "pref-hint" }, "Band width = grayscale tolerance around the detected line shade (color sensitivity), not point count." ),
        chk("dg-keep-largest", false, "Keep only largest blob"),
      ]),
      block("Output", [
        prefRow("Mode", selectEl("dg-output-mode", [["line", "Line trace"], ["symbols", "Symbol centroids"]])),
        prefRow("Point spacing", numEl("dg-point-step", 1, { min: 1, max: 200 })),
        el("div", { class: "pref-hint" }, "Line trace: one point per N pixel columns — 1 = densest, larger = sparser." ),
        prefRow("Min symbol area", numEl("dg-min-area", 5, { min: 1, max: 10000 })),
        chk("dg-split-symbols", true, "Split touching symbols"),
        prefRow("Symbol size", numEl("dg-symbol-size", 12, { min: 3, max: 100 })),
        el("div", { class: "pref-hint" }, "Symbols: splits overlapping filled markers into one point each. Symbol size ≈ marker diameter (px)." ),
      ]),
      el("div", { class: "dp-block" }, [
        el("button", { id: "dg-prep-defaults" }, "Reset preprocess to defaults"),
        el("div", { class: "pref-hint" }, "Preprocess settings are remembered between sessions; this restores the defaults." ),
      ]),
    ]));

    sections.appendChild(el("div", { class: "dp-section", "data-sec": "region" }, [
      block("Brush mask", [
        el("div", { class: "pref-hint" }, "Paint to keep only the brushed region; erase to remove. Intersected with the calibration bbox at extract time."),
        el("div", { class: "row" }, [
          el("button", { id: "dg-brush", class: "toggle" }, "Brush"),
          el("button", { id: "dg-eraser", class: "toggle" }, "Eraser"),
          el("button", { id: "dg-clear-brush" }, "Clear"),
        ]),
        prefRow("Brush size", numEl("dg-brush-r", 15, { min: 2, max: 200 })),
      ]),
    ]));

    sections.appendChild(el("div", { class: "dp-section", "data-sec": "result" }, [
      block("Overlay style", [
        el("div", { class: "pref-hint" }, "How the extracted trajectory is drawn over the image. Line trace draws a connected line; symbols draw circles." ),
        prefRow("Color", el("input", { type: "color", id: "dg-ov-color", value: "#1d4ed8" })),
        prefRow("Line width", numEl("dg-ov-linew", 2, { min: 0.5, max: 12, step: 0.5 })),
        prefRow("Marker size", numEl("dg-ov-symsize", 4, { min: 1, max: 30 })),
      ]),
    ]));

    // Column 3: toolbar (zoom + view + reset) above a canvas | data row.
    const col = el("div", { class: "dp-canvas-col" });
    col.appendChild(el("div", { class: "dg-toolbar" }, [
      el("span", { class: "dg-zoom" }, [
        el("button", { id: "dg-zoom-out", title: "Zoom out" }, "−"),
        el("span", { id: "dg-zoom-label", class: "hint" }, "100%"),
        el("button", { id: "dg-zoom-in", title: "Zoom in" }, "+"),
        el("button", { id: "dg-zoom-fit" }, "Fit"),
      ]),
      el("span", { class: "dg-seg", id: "dg-view" }, [
        viewRadio("Original", "Original", true),
        viewRadio("Preprocessed", "Preprocessed", false),
        viewRadio("Grid", "Grid detection", false),
      ]),
      el("button", { id: "dg-reset-result" }, "Reset"),
      el("span", { class: "spacer" }),
    ]));
    const work = el("div", { class: "dg-work" });
    work.appendChild(el("div", { class: "plot-area", id: "dg-canvas-area" }, [
      el("canvas", { id: "dg-canvas" }),
      el("div", { class: "dropzone hidden", id: "dg-dropzone" }, "Drop image here"),
    ]));
    work.appendChild(el("div", { class: "group dg-data" }, [
      el("h3", {}, "Extracted data"),
      el("div", { class: "table-container", id: "dg-result-host" }),
      el("div", { class: "row" }, [
        el("button", { id: "dg-copy-result" }, "Copy"),
        el("button", { id: "dg-save-csv" }, "Save CSV"),
      ]),
      el("div", { id: "dg-result-info", class: "hint" }, ""),
    ]));
    col.appendChild(work);
    layout.appendChild(col);
  }

  function showSection(id) {
    $$("#dg-nav li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-sec") === id));
    $$("#dg-sections .dp-section").forEach((s) => s.classList.toggle("active", s.getAttribute("data-sec") === id));
  }

  function viewValue() {
    const r = $$('input[name="dg-view"]').find((x) => x.checked);
    return r ? r.value : "Original";
  }

  function bindEvents(root) {
    _state = freshState();

    U.$("#dg-load").addEventListener("click", () => U.$("#dg-file").click());
    U.$("#dg-file").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = await IP.readImageFile(f);
        adoptImage(data, f.name);
      } catch (e2) { U.setStatus(String(e2), "error"); }
    });
    U.$("#dg-paste").addEventListener("click", async () => {
      const data = await IP.readImageFromClipboard();
      if (data) adoptImage(data, "<clipboard>");
      else U.setStatus("Clipboard has no image.", "warn");
    });

    document.addEventListener("paste", async (e) => {
      const tab = U.$("section.tab-panel.active");
      if (!tab || tab.dataset.tab !== "digitizer") return;
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (!blob) continue;
          try {
            const data = await IP.readImageFile(blob);
            adoptImage(data, "<clipboard>");
            return;
          } catch (e2) { U.setStatus(String(e2), "error"); return; }
        }
      }
    });

    // Drag and drop
    const area = U.$("#dg-canvas-area");
    const dz = U.$("#dg-dropzone");
    area.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.remove("hidden"); dz.classList.add("hover"); });
    area.addEventListener("dragleave", (e) => { dz.classList.remove("hover"); dz.classList.add("hidden"); });
    area.addEventListener("drop", async (e) => {
      e.preventDefault();
      dz.classList.add("hidden");
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      try {
        const data = await IP.readImageFile(f);
        adoptImage(data, f.name);
      } catch (e2) { U.setStatus(String(e2), "error"); }
    });

    // Mode toggles
    const modeBtns = [
      ["dg-pick-x", MODE_PICK_X],
      ["dg-pick-y", MODE_PICK_Y],
      ["dg-brush", MODE_BRUSH],
      ["dg-eraser", MODE_ERASER],
      ["dg-pick-color", MODE_PICK_COLOR],
    ];
    modeBtns.forEach(([id, m]) => {
      U.$("#" + id).addEventListener("click", () => setMode(m));
    });

    // Cal table edits
    U.$("#dg-cal-table").addEventListener("change", (e) => {
      const t = e.target;
      const idx = Number(t.dataset.idx);
      const field = t.dataset.field;
      if (!Number.isFinite(idx) || !field) return;
      const v = t.value.trim();
      if (field === "data") {
        const n = Number(v);
        _state.cal[idx].data = Number.isFinite(n) ? n : null;
      } else {
        const n = Number(v);
        _state.cal[idx][field] = Number.isFinite(n) ? n : null;
      }
      render();
    });

    U.$("#dg-clear-x").addEventListener("click", () => clearAxis("x"));
    U.$("#dg-clear-y").addEventListener("click", () => clearAxis("y"));
    U.$("#dg-reset-cal").addEventListener("click", resetCal);
    U.$("#dg-clear-brush").addEventListener("click", () => { _state.brushMask = null; render(); });
    U.$("#dg-clear-color").addEventListener("click", () => {
      _state.targetColor = null;
      U.$("#dg-color-swatch").textContent = "(none)";
      U.$("#dg-color-swatch").style.backgroundColor = "";
      U.$("#dg-color-swatch").style.color = "";
    });
    U.$("#dg-lv-reset").addEventListener("click", () => {
      U.$("#dg-lv-black").value = 0;
      U.$("#dg-lv-white").value = 255;
      U.$("#dg-lv-gamma").value = 1.0;
      _state.previewDirty = true;
      render();
      if (_persist) _persist();
    });

    // All preview-affecting controls
    const previewControls = [
      "dg-auto-invert", "dg-lv-black", "dg-lv-white", "dg-lv-gamma",
      "dg-remove-grid", "dg-grid-len", "dg-grid-thick", "dg-grid-thresh",
    ];
    previewControls.forEach((id) => {
      const e = U.$("#" + id);
      const handler = U.debounce(() => { _state.previewDirty = true; render(); }, 150);
      e.addEventListener("change", handler);
      if (e.tagName === "INPUT" && (e.type === "number")) e.addEventListener("input", handler);
    });

    // View radios (Original / Preprocessed / Grid) — just re-render.
    U.$$('input[name="dg-view"]').forEach((r) => r.addEventListener("change", () => { _state.view = viewValue(); render(); }));

    // Zoom controls
    U.$("#dg-zoom-in").addEventListener("click", () => applyZoom((_state.zoom || 1) * 1.25));
    U.$("#dg-zoom-out").addEventListener("click", () => applyZoom((_state.zoom || 1) / 1.25));
    U.$("#dg-zoom-fit").addEventListener("click", () => { const a = U.$("#dg-canvas-area"); applyZoom(1); a.scrollLeft = 0; a.scrollTop = 0; });
    U.$("#dg-canvas-area").addEventListener("wheel", (e) => {
      if (!_state.gray) return;
      e.preventDefault();
      applyZoom((_state.zoom || 1) * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e);
    }, { passive: false });

    U.$("#dg-extract").addEventListener("click", extract);
    U.$("#dg-copy-result").addEventListener("click", copyResult);
    U.$("#dg-save-csv").addEventListener("click", saveCSV);
    U.$("#dg-reset-result").addEventListener("click", clearResult);

    // Overlay style → live re-render of the trajectory.
    ["dg-ov-color", "dg-ov-linew", "dg-ov-symsize"].forEach((id) => {
      const e = U.$("#" + id);
      e.addEventListener("change", render);
      e.addEventListener("input", render);
    });

    // Canvas interaction
    const canvas = U.$("#dg-canvas");
    canvas.addEventListener("mousedown", onCanvasDown);
    canvas.addEventListener("mousemove", onCanvasMove);
    canvas.addEventListener("mouseup", onCanvasUp);
    canvas.addEventListener("mouseleave", onCanvasUp);

    window.addEventListener("resize", U.debounce(() => { if (_state?.gray) render(); }, 150));
  }

  function adoptImage(data, sourceName) {
    _state = freshState();
    _state.rgba = data.rgba;
    _state.gray = data.gray;
    _state.width = data.width;
    _state.height = data.height;
    _state.sourceName = sourceName;
    U.$("#dg-filename").textContent = `${sourceName} — ${data.width} × ${data.height}`;
    updateZoomLabel();
    U.setStatus(`Image loaded.`);
    render();
  }

  // ---------- Zoom ----------
  const ZOOM_MIN = 0.2, ZOOM_MAX = 16;
  function updateZoomLabel() {
    const l = U.$("#dg-zoom-label");
    if (l) l.textContent = Math.round((_state.zoom || 1) * 100) + "%";
  }
  function applyZoom(newZoom, anchorEvt) {
    if (!_state.gray) return;
    newZoom = U.clamp(newZoom, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(newZoom - (_state.zoom || 1)) < 1e-4) return;
    const before = anchorEvt ? canvasToImageCoord(anchorEvt) : null;
    _state.zoom = newZoom;
    render();
    updateZoomLabel();
    // Keep the image point under the cursor stationary while wheel-zooming.
    if (before) {
      const canvas = U.$("#dg-canvas"), area = U.$("#dg-canvas-area");
      const layout = computeCanvasLayout();
      const rect = canvas.getBoundingClientRect();
      area.scrollLeft += (rect.left + before.x * layout.ratio) - anchorEvt.clientX;
      area.scrollTop += (rect.top + before.y * layout.ratio) - anchorEvt.clientY;
    }
  }

  function setMode(m) {
    _state.mode = _state.mode === m ? MODE_NONE : m;
    const map = {
      [MODE_PICK_X]: "dg-pick-x",
      [MODE_PICK_Y]: "dg-pick-y",
      [MODE_BRUSH]: "dg-brush",
      [MODE_ERASER]: "dg-eraser",
      [MODE_PICK_COLOR]: "dg-pick-color",
    };
    Object.entries(map).forEach(([key, id]) => {
      U.$("#" + id).classList.toggle("active", _state.mode === key);
    });
  }

  function clearAxis(axis) {
    _state.cal.forEach((r) => {
      if (r.axis === axis) { r.data = null; r.px = null; r.py = null; }
    });
    render();
  }
  function resetCal() {
    _state.cal.forEach((r) => { r.data = null; r.px = null; r.py = null; });
    render();
  }

  // ---------- Canvas events ----------
  function canvasToImageCoord(evt) {
    const canvas = U.$("#dg-canvas");
    const rect = canvas.getBoundingClientRect();
    const cx = evt.clientX - rect.left;
    const cy = evt.clientY - rect.top;
    if (!_state.width) return null;
    // We render at fit-to-area scale; compute ratio.
    const layout = computeCanvasLayout();
    if (!layout) return null;
    const ix = (cx - layout.offsetX) * (_state.width / layout.drawW);
    const iy = (cy - layout.offsetY) * (_state.height / layout.drawH);
    if (ix < 0 || ix >= _state.width || iy < 0 || iy >= _state.height) return null;
    return { x: ix, y: iy };
  }

  function computeCanvasLayout() {
    if (!_state.width) return null;
    const area = U.$("#dg-canvas-area");
    const w = Math.max(40, area.clientWidth - 4);
    const h = Math.max(40, area.clientHeight - 4);
    const fit = Math.min(w / _state.width, h / _state.height);
    const ratio = fit * (_state.zoom || 1);
    const drawW = Math.max(1, Math.round(_state.width * ratio));
    const drawH = Math.max(1, Math.round(_state.height * ratio));
    // Canvas is exactly the scaled image; the scrollable area handles overflow
    // and centres it (margin:auto) when smaller. No internal offset.
    return { cssW: drawW, cssH: drawH, drawW, drawH, offsetX: 0, offsetY: 0, ratio };
  }

  function findCalNear(ix, iy, radiusPx = 12) {
    const layout = computeCanvasLayout();
    if (!layout) return -1;
    const r2 = (radiusPx / layout.ratio) ** 2;  // squared in image coords
    let best = -1, bestD = Infinity;
    _state.cal.forEach((c, i) => {
      if (c.px == null || c.py == null) return;
      const d = (c.px - ix) ** 2 + (c.py - iy) ** 2;
      if (d < r2 && d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function onCanvasDown(e) {
    if (!_state.gray) return;
    const p = canvasToImageCoord(e);
    if (!p) return;

    // Drag existing cal marker has priority.
    const hit = findCalNear(p.x, p.y);
    if (hit >= 0) { _state.dragIdx = hit; return; }

    if (_state.mode === MODE_PICK_X) placeCal("x", p.x, p.y);
    else if (_state.mode === MODE_PICK_Y) placeCal("y", p.x, p.y);
    else if (_state.mode === MODE_BRUSH || _state.mode === MODE_ERASER) {
      _state.brushPainting = true;
      paintAt(p.x, p.y, _state.mode === MODE_ERASER);
    } else if (_state.mode === MODE_PICK_COLOR) {
      pickColorAt(p.x, p.y);
    }
  }
  function onCanvasMove(e) {
    if (!_state.gray) return;
    const p = canvasToImageCoord(e);
    if (!p) return;
    if (_state.dragIdx != null) {
      _state.cal[_state.dragIdx].px = p.x;
      _state.cal[_state.dragIdx].py = p.y;
      render();
    } else if (_state.brushPainting) {
      paintAt(p.x, p.y, _state.mode === MODE_ERASER);
    }
  }
  function onCanvasUp() {
    _state.dragIdx = null;
    _state.brushPainting = false;
  }

  function placeCal(axis, ix, iy) {
    const slot = _state.cal.find((r) => r.axis === axis && r.px == null);
    if (!slot) {
      U.setStatus(`Both ${axis.toUpperCase()} points already set. Drag to move.`, "warn");
      return;
    }
    slot.px = ix;
    slot.py = iy;
    render();
  }

  function pickColorAt(ix, iy) {
    if (!_state.rgba) return;
    const x = Math.round(ix), y = Math.round(iy);
    const off = 4 * (y * _state.width + x);
    const r = _state.rgba[off];
    const g = _state.rgba[off + 1];
    const b = _state.rgba[off + 2];
    _state.targetColor = [r, g, b];
    const swatch = U.$("#dg-color-swatch");
    swatch.textContent = `${r},${g},${b}`;
    swatch.style.backgroundColor = `rgb(${r},${g},${b})`;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    swatch.style.color = lum < 128 ? "#fff" : "#000";
    setMode(MODE_NONE);
  }

  function paintAt(ix, iy, erase) {
    if (!_state.gray) return;
    if (!_state.brushMask) _state.brushMask = new Uint8Array(_state.width * _state.height);
    const r = Number(U.$("#dg-brush-r").value) || 15;
    const cx = Math.round(ix), cy = Math.round(iy);
    const x0 = Math.max(0, cx - r);
    const y0 = Math.max(0, cy - r);
    const x1 = Math.min(_state.width, cx + r + 1);
    const y1 = Math.min(_state.height, cy + r + 1);
    const r2 = r * r;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          _state.brushMask[y * _state.width + x] = erase ? 0 : 1;
        }
      }
    }
    render();
  }

  // ---------- Bbox + preprocess + extract ----------

  function calBbox() {
    const pts = _state.cal.filter((r) => r.px != null && r.py != null);
    if (pts.length < 4) return null;
    const xs = pts.map((p) => p.px);
    const ys = pts.map((p) => p.py);
    return [
      Math.max(0, Math.floor(Math.min(...xs))),
      Math.max(0, Math.floor(Math.min(...ys))),
      Math.min(_state.width, Math.ceil(Math.max(...xs))),
      Math.min(_state.height, Math.ceil(Math.max(...ys))),
    ];
  }

  function computePreview(bbox) {
    if (!_state.gray) return null;
    let work = new Uint8ClampedArray(_state.gray);
    // Auto-invert
    if (U.$("#dg-auto-invert").checked) {
      // Compute mean inside bbox if available, else full.
      let sum = 0, n = 0;
      if (bbox) {
        for (let y = bbox[1]; y < bbox[3]; y++) {
          for (let x = bbox[0]; x < bbox[2]; x++) { sum += work[y * _state.width + x]; n++; }
        }
      } else {
        for (let i = 0; i < work.length; i++) sum += work[i];
        n = work.length;
      }
      if (n > 0 && sum / n < 128) {
        for (let i = 0; i < work.length; i++) work[i] = 255 - work[i];
      }
    }
    // Levels
    const black = Number(U.$("#dg-lv-black").value);
    const white = Number(U.$("#dg-lv-white").value);
    const gamma = Number(U.$("#dg-lv-gamma").value) || 1.0;
    work = IP.adjustLevels(work, black, white, gamma);
    // Grid removal
    if (U.$("#dg-remove-grid").checked) {
      const threshRaw = Number(U.$("#dg-grid-thresh").value);
      const opts = {
        lineLength: Number(U.$("#dg-grid-len").value) || 20,
        thickness: Number(U.$("#dg-grid-thick").value) || 2,
        threshold: threshRaw > 0 ? threshRaw : null,
        bbox: bbox || [0, 0, _state.width, _state.height],
        inset: 3,
      };
      work = IP.removeGridLines(work, _state.width, _state.height, opts);
    }
    return work;
  }

  function extract() {
    if (!_state.gray) { U.setStatus("Load an image first.", "warn"); return; }
    const missing = _state.cal.filter((r) => r.px == null || r.data == null);
    if (missing.length) {
      U.setStatus("Need all 4 calibration points + values: " + missing.map((m) => m.label).join(", "), "warn");
      return;
    }
    const bbox = calBbox();
    if (!bbox) { U.setStatus("Bad bbox.", "error"); return; }
    const [bx0, by0, bx1, by1] = bbox;
    if (bx1 - bx0 < 5 || by1 - by0 < 5) {
      U.setStatus("Cal bbox too tight.", "error");
      return;
    }

    // Polyfit transforms.
    const logX = U.$("#dg-log-x").checked;
    const logY = U.$("#dg-log-y").checked;
    const xCal = _state.cal.filter((r) => r.axis === "x");
    const yCal = _state.cal.filter((r) => r.axis === "y");
    const xData = xCal.map((r) => logX ? Math.log10(r.data) : r.data);
    const yData = yCal.map((r) => logY ? Math.log10(r.data) : r.data);
    if (xData.some((v) => !Number.isFinite(v))) {
      U.setStatus("Log X requires positive values.", "error"); return;
    }
    if (yData.some((v) => !Number.isFinite(v))) {
      U.setStatus("Log Y requires positive values.", "error"); return;
    }
    if (xData[0] === xData[1]) { U.setStatus("X cal values must differ.", "error"); return; }
    if (yData[0] === yData[1]) { U.setStatus("Y cal values must differ.", "error"); return; }
    const xPx = xCal.map((r) => r.px);
    const yPy = yCal.map((r) => r.py);
    const [offX, sX] = N.polyfit1(xData, xPx);
    const [offY, sY] = N.polyfit1(yData, yPy);
    const transform = { sX, offX, sY, offY, logX, logY };

    // Preprocess gray, with bbox-only path (faster).
    const pre = computePreview(bbox);
    if (!pre) return;

    // Detect band: either color match or fgbg histogram band.
    const W = _state.width, H = _state.height;
    let mask = new Uint8Array(W * H);
    let detectionLabel = "";

    if (_state.targetColor && _state.rgba) {
      const tol = Number(U.$("#dg-color-tol").value) || 30;
      mask = IP.colorDistanceMask(_state.rgba, W, H, _state.targetColor, tol);
      detectionLabel = `color RGB(${_state.targetColor.join(",")}) ±${tol}`;
    } else {
      // Histogram on bbox subarray.
      const roiW = bx1 - bx0, roiH = by1 - by0;
      const roi = new Uint8ClampedArray(roiW * roiH);
      for (let y = 0; y < roiH; y++) {
        for (let x = 0; x < roiW; x++) roi[y * roiW + x] = pre[(y + by0) * W + (x + bx0)];
      }
      let stats;
      try { stats = IP.fgbgStats(roi); }
      catch (e) {
        U.setStatus("No trajectory color detected. Try Pick line color, or widen the bbox.", "error");
        return;
      }
      if (stats.trajcolors.length === 0) {
        U.setStatus("No trajectory color detected.", "error");
        return;
      }
      const tc = stats.trajcolors[0];
      const band = Number(U.$("#dg-band").value) || 6;
      const lo = Math.max(0, tc - band / 2);
      const hi = Math.min(255, tc + band / 2);
      for (let y = by0; y < by1; y++) {
        for (let x = bx0; x < bx1; x++) {
          const v = pre[y * W + x];
          if (v >= lo && v <= hi) mask[y * W + x] = 1;
        }
      }
      detectionLabel = `traj=${tc}, band ±${band/2}`;
    }

    // Restrict by bbox.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x < bx0 || x >= bx1 || y < by0 || y >= by1) mask[y * W + x] = 0;
      }
    }
    // Brush mask intersection if any.
    if (_state.brushMask && _state.brushMask.some((v) => v)) {
      for (let i = 0; i < mask.length; i++) mask[i] = mask[i] & _state.brushMask[i];
    }
    // ROI rect intersection (TODO if used)

    if (U.$("#dg-keep-largest").checked) {
      mask = IP.keepLargest(mask, W, H);
    }

    const outputMode = U.$("#dg-output-mode").value;
    const minSymArea = Number(U.$("#dg-min-area").value) || 5;
    const xStep = Number(U.$("#dg-point-step").value) || 1;
    const splitTouching = U.$("#dg-split-symbols").checked;
    const symbolSize = Number(U.$("#dg-symbol-size").value) || 12;
    const traj = IP.extractFromMask(mask, W, H, {
      bbox, transform, outputMode, minSymbolArea: minSymArea, xStep,
      splitTouching, minSep: Math.max(3, symbolSize * 0.6),
    });

    if (traj.length === 0) {
      U.setStatus("Extraction produced 0 points.", "warn");
      return;
    }
    _state.result = traj;
    _state.resultMode = outputMode;
    populateResultTable();
    render();   // draw the overlay immediately (was a no-op call before)
    U.$("#dg-result-info").textContent = `${traj.length} points (${detectionLabel})`;
    U.setStatus(`Extracted ${traj.length} points.`);
  }

  function populateResultTable() {
    const host = U.$("#dg-result-host");
    host.innerHTML = "";
    const t = U.el("table", { class: "data-table" });
    t.appendChild(U.el("thead", {}, U.el("tr", {}, [U.el("th", {}, "X"), U.el("th", {}, "Y")])));
    const tb = U.el("tbody");
    for (const [x, y] of _state.result) {
      tb.appendChild(U.el("tr", {}, [
        U.el("td", {}, U.fmt(x, 6)),
        U.el("td", {}, U.fmt(y, 6)),
      ]));
    }
    t.appendChild(tb);
    host.appendChild(t);
  }

  function clearResult() {
    _state.result = [];
    U.$("#dg-result-host").innerHTML = "";
    U.$("#dg-result-info").textContent = "";
    render();
    U.setStatus("Extracted result cleared — adjust settings and extract again.");
  }

  function copyResult() {
    if (!_state.result.length) return;
    const text = ["X\tY", ..._state.result.map(([x, y]) => `${U.fmt(x, 6)}\t${U.fmt(y, 6)}`)].join("\n");
    U.copyToClipboard(text).then(() => U.setStatus("Result copied as TSV."));
  }

  function saveCSV() {
    if (!_state.result.length) return;
    const text = ["X,Y", ..._state.result.map(([x, y]) => `${x},${y}`)].join("\n");
    U.downloadText(text, "digitizer_data.csv");
    U.setStatus("Result saved.");
  }

  // ---------- Rendering ----------

  function render() {
    syncCalTable();
    if (!_state.gray) return;
    renderCanvas();
  }

  function syncCalTable() {
    const inputs = U.$$("#dg-cal-table input");
    inputs.forEach((inp) => {
      const idx = Number(inp.dataset.idx);
      const f = inp.dataset.field;
      const v = _state.cal[idx][f];
      if (v == null) {
        if (document.activeElement !== inp) inp.value = "";
      } else {
        const formatted = (f === "data") ? String(v) : U.fmt(v, 4);
        if (document.activeElement !== inp) inp.value = formatted;
      }
    });
  }

  function renderCanvas() {
    const canvas = U.$("#dg-canvas");
    const layout = computeCanvasLayout();
    if (!layout) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = layout.cssW + "px";
    canvas.style.height = layout.cssH + "px";
    canvas.width = Math.round(layout.cssW * dpr);
    canvas.height = Math.round(layout.cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.cssW, layout.cssH);
    ctx.imageSmoothingEnabled = false;

    // Determine which image data to show.
    const view = viewValue();
    _state.view = view;
    if (view === "Preprocessed") {
      if (_state.previewDirty || !_state.preview) {
        _state.preview = computePreview(calBbox());
        _state.previewDirty = false;
      }
      // Draw grayscale preview.
      const imgData = IP.grayToImageData(_state.preview, _state.width, _state.height);
      drawImageDataScaled(ctx, imgData, layout);
    } else {
      // Original (RGB).
      const tmp = document.createElement("canvas");
      tmp.width = _state.width;
      tmp.height = _state.height;
      const tctx = tmp.getContext("2d");
      tctx.putImageData(new ImageData(_state.rgba, _state.width, _state.height), 0, 0);
      ctx.drawImage(tmp, 0, 0, _state.width, _state.height, layout.offsetX, layout.offsetY, layout.drawW, layout.drawH);
      if (view === "Grid") drawGridMaskOverlay(ctx, layout);
    }

    // Overlays
    drawBrushOverlay(ctx, layout);
    drawCalMarkers(ctx, layout);
    drawBboxOverlay(ctx, layout);
    drawTrajResult(ctx, layout);
  }

  function drawImageDataScaled(ctx, imgData, layout) {
    const tmp = document.createElement("canvas");
    tmp.width = imgData.width;
    tmp.height = imgData.height;
    tmp.getContext("2d").putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0, imgData.width, imgData.height, layout.offsetX, layout.offsetY, layout.drawW, layout.drawH);
  }

  function drawGridMaskOverlay(ctx, layout) {
    const threshRaw = Number(U.$("#dg-grid-thresh").value);
    const pre = computePreview(calBbox());
    const mask = IP.gridMask(pre, _state.width, _state.height, {
      lineLength: Number(U.$("#dg-grid-len").value) || 20,
      thickness: Number(U.$("#dg-grid-thick").value) || 2,
      threshold: threshRaw > 0 ? threshRaw : null,
      bbox: calBbox() || [0, 0, _state.width, _state.height],
      inset: 3,
    });
    const idata = new ImageData(_state.width, _state.height);
    for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
      if (mask[i]) {
        idata.data[j] = 255; idata.data[j + 1] = 30; idata.data[j + 2] = 30; idata.data[j + 3] = 160;
      } else {
        idata.data[j + 3] = 0;
      }
    }
    drawImageDataScaled(ctx, idata, layout);
  }

  function drawBrushOverlay(ctx, layout) {
    if (!_state.brushMask) return;
    const idata = new ImageData(_state.width, _state.height);
    for (let i = 0, j = 0; i < _state.brushMask.length; i++, j += 4) {
      if (_state.brushMask[i]) {
        idata.data[j] = 255; idata.data[j + 1] = 220; idata.data[j + 2] = 50; idata.data[j + 3] = 90;
      } else {
        idata.data[j + 3] = 0;
      }
    }
    drawImageDataScaled(ctx, idata, layout);
  }

  function drawCalMarkers(ctx, layout) {
    ctx.save();
    ctx.font = "11px system-ui";
    _state.cal.forEach((c) => {
      if (c.px == null || c.py == null) return;
      const px = layout.offsetX + c.px * layout.ratio;
      const py = layout.offsetY + c.py * layout.ratio;
      ctx.strokeStyle = c.color;
      ctx.fillStyle = c.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      const sz = 8;
      ctx.moveTo(px - sz, py); ctx.lineTo(px + sz, py);
      ctx.moveTo(px, py - sz); ctx.lineTo(px, py + sz);
      ctx.stroke();
      ctx.fillText(c.label, px + 6, py - 6);
    });
    ctx.restore();
  }

  function drawBboxOverlay(ctx, layout) {
    const b = calBbox();
    if (!b) return;
    const [x0, y0, x1, y1] = b;
    ctx.save();
    ctx.strokeStyle = "#2563eb";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(
      layout.offsetX + x0 * layout.ratio + 0.5,
      layout.offsetY + y0 * layout.ratio + 0.5,
      (x1 - x0) * layout.ratio,
      (y1 - y0) * layout.ratio,
    );
    ctx.restore();
  }

  function drawTrajResult(ctx, layout) {
    if (!_state.result.length) return;
    const xCal = _state.cal.filter((r) => r.axis === "x" && r.data != null);
    const yCal = _state.cal.filter((r) => r.axis === "y" && r.data != null);
    if (xCal.length !== 2 || yCal.length !== 2) return;
    const logX = U.$("#dg-log-x").checked;
    const logY = U.$("#dg-log-y").checked;
    const xData = xCal.map((r) => logX ? Math.log10(r.data) : r.data);
    const yData = yCal.map((r) => logY ? Math.log10(r.data) : r.data);
    let offX, sX, offY, sY;
    try {
      [offX, sX] = N.polyfit1(xData, xCal.map((r) => r.px));
      [offY, sY] = N.polyfit1(yData, yCal.map((r) => r.py));
    } catch (e) { return; }

    const color = U.$("#dg-ov-color").value || "#1d4ed8";
    const lineW = Number(U.$("#dg-ov-linew").value) || 2;
    const symR = Number(U.$("#dg-ov-symsize").value) || 4;
    const asLine = (_state.resultMode || "line") === "line";

    // Project each data point back to on-screen pixel coords.
    const pts = _state.result.map(([dx, dy]) => {
      const rx = logX ? Math.log10(dx) : dx;
      const ry = logY ? Math.log10(dy) : dy;
      return [layout.offsetX + (rx * sX + offX) * layout.ratio, layout.offsetY + (ry * sY + offY) * layout.ratio];
    });

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (asLine) {
      ctx.lineWidth = lineW;
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach(([px, py], i) => { if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
      ctx.stroke();
    } else {
      for (const [px, py] of pts) {
        ctx.beginPath();
        ctx.arc(px, py, symR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------- Settings persistence ----------
  function dgGet(id, type) {
    const e = U.$("#" + id);
    if (!e) return undefined;
    if (type === "check") return e.checked;
    if (type === "num") { const n = Number(e.value); return Number.isFinite(n) ? n : undefined; }
    return e.value;
  }
  function dgSet(id, type, v) {
    const e = U.$("#" + id);
    if (!e || v == null) return;
    if (type === "check") e.checked = !!v; else e.value = v;
  }
  function persistSettings() {
    const s = {};
    for (const [id, key, type] of PERSIST) { const v = dgGet(id, type); if (v !== undefined) s[key] = v; }
    s.view = viewValue();
    window.LUMOS_config.update({ digitizer_settings: s });
  }
  function restoreSettings() {
    const cfg = window.LUMOS_config.load().digitizer_settings || {};
    for (const [id, key, type] of PERSIST) { if (cfg[key] !== undefined) dgSet(id, type, cfg[key]); }
    const v = cfg.view || "Original";
    U.$$('input[name="dg-view"]').forEach((r) => { r.checked = r.value === v; });
  }
  function resetPrepDefaults() {
    const d = window.LUMOS_config.DEFAULTS.digitizer_settings;
    for (const [id, key, type, group] of PERSIST) { if (group === "prep") dgSet(id, type, d[key]); }
    _state.previewDirty = true;
    render();
    if (_persist) _persist();
    U.setStatus("Preprocess settings reset to defaults.");
  }

  function init(root) {
    buildUI(root);
    bindEvents(root);
    _persist = U.debounce(persistSettings, 300);
    restoreSettings();
    PERSIST.forEach(([id]) => { const e = U.$("#" + id); if (!e) return; e.addEventListener("change", _persist); e.addEventListener("input", _persist); });
    U.$$('input[name="dg-view"]').forEach((r) => r.addEventListener("change", _persist));
    U.$("#dg-prep-defaults").addEventListener("click", resetPrepDefaults);
  }

  function onShow() {
    if (_state?.gray) requestAnimationFrame(render);
  }

  window.LUMOS_tab_digitizer = { init, onShow };
})();


    

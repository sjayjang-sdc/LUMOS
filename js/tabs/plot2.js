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

// Top-level app shell: tab switching, master-detail Preferences modal,
// lazy tab init.
"use strict";

(function () {
  const { $, $$, el, setStatus } = window.LUMOS_util;
  const CFG = window.LUMOS_config;

  const TABS = {
    plot: window.LUMOS_tab_plot,
    map: window.LUMOS_tab_map,
    boxplot: window.LUMOS_tab_boxplot,
    digitizer: window.LUMOS_tab_digitizer,
  };
  const _builtTabs = new Set();

  // ---------- Tab switching ----------

  function activateTab(name) {
    if (window.LUMOS_log) window.LUMOS_log.log("tab -> " + name);
    $$(".tab", $("#tab-bar")).forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === name);
    });
    $$(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.tab === name);
    });
    if (!_builtTabs.has(name)) {
      const tab = TABS[name];
      if (tab && typeof tab.init === "function") {
        try {
          tab.init(document.getElementById(`tab-${name}`));
          _builtTabs.add(name);
        } catch (e) {
          console.error(`Failed to init tab '${name}':`, e);
          document.getElementById(`tab-${name}`).innerHTML =
            `<div style="padding:20px; color:var(--error);">Tab init error: ${String(e)}</div>`;
        }
      }
    }
    if (TABS[name] && typeof TABS[name].onShow === "function") TABS[name].onShow();
  }

  function bindTabBar() {
    $("#tab-bar").addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (btn) activateTab(btn.dataset.tab);
    });
  }

  // ---------- Preferences (Colors): swatch table + colormap gradient list ----------

  let _colorRows = [];        // working list of priority color strings
  let _selectedCmap = "viridis";

  function gradientCanvas(name) {
    const c = document.createElement("canvas");
    c.width = 140;
    c.height = 16;
    c.className = "cmap-bar";
    const ctx = c.getContext("2d");
    for (let x = 0; x < 140; x++) {
      const [r, g, b] = window.LUMOS_plotting.cmapLookup(name, x / 139);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, 16);
    }
    return c;
  }

  function buildPrefsUI() {
    const nav = $("#settings-nav");
    const pages = $("#settings-pages");
    nav.innerHTML = "";
    pages.innerHTML = "";

    [["general", "General"], ["colors", "Colors"]].forEach(([id, label], i) => {
      const li = el("li", { "data-page": id, class: i === 0 ? "active" : "" }, label);
      li.addEventListener("click", () => showSettingsPage(id));
      nav.appendChild(li);
    });

    // General page: language picker.
    const langSel = el("select", { id: "pref-language" });
    (window.LUMOS_i18n ? window.LUMOS_i18n.LANGS : [["en", "English"]]).forEach(([v, l]) => langSel.appendChild(el("option", { value: v }, l)));
    pages.appendChild(el("div", { class: "settings-page active", "data-page": "general" }, [
      el("h3", {}, "General"),
      el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, "Language"), langSel]),
      el("div", { class: "pref-hint", style: "margin:0 0 12px;" }, "Changing the language reloads the app."),
      el("label", { class: "pref-row" }, [
        el("input", { type: "checkbox", id: "pref-logging" }), " Enable diagnostic logging",
      ]),
      el("div", { class: "row" }, [
        el("button", { id: "pref-log-download" }, "Download log"),
        el("button", { id: "pref-log-copy" }, "Copy log"),
        el("button", { id: "pref-log-clear" }, "Clear log"),
      ]),
      el("div", { class: "pref-hint", style: "margin-top:8px;" }, "Logs (incl. memory use) survive a crash. The lines just above the last “session start” are the crashed run."),
      el("textarea", { id: "pref-log-view", readonly: true, rows: 12, style: "width:100%; font-family:monospace; font-size:11px; white-space:pre;" }),
    ]));

    $("#pref-log-download").addEventListener("click", () => {
      const txt = (window.LUMOS_log && window.LUMOS_log.dump()) || "";
      window.LUMOS_util.downloadText(txt || "(log empty)", "lumos-log.txt");
    });
    $("#pref-log-copy").addEventListener("click", () => {
      const txt = (window.LUMOS_log && window.LUMOS_log.dump()) || "";
      window.LUMOS_util.copyToClipboard(txt).then((ok) => setStatus(ok ? "Log copied." : "Copy failed.", ok ? "" : "warn"));
    });
    $("#pref-log-clear").addEventListener("click", () => {
      if (window.LUMOS_log) window.LUMOS_log.clear();
      const v = $("#pref-log-view"); if (v) v.value = "";
      setStatus("Log cleared.");
    });

    const presetSel = el("select", { id: "pref-preset" });
    Object.keys(CFG.COLOR_PRESETS).forEach((name) => presetSel.appendChild(el("option", { value: name }, name)));
    presetSel.appendChild(el("option", { value: "Custom" }, "Custom"));
    presetSel.addEventListener("change", () => {
      const v = presetSel.value;
      if (v !== "Custom" && CFG.COLOR_PRESETS[v]) {
        _colorRows = CFG.COLOR_PRESETS[v].slice();
        renderColorTable();
      }
    });

    const page = el("div", { class: "settings-page", "data-page": "colors" }, [
      el("h3", {}, "Colors"),
      el("div", { class: "pref-row" }, [el("label", { class: "pref-label" }, "Preset"), presetSel]),
      el("div", { class: "field-label", style: "margin-top:10px;" }, "Priority colors (top = highest priority)"),
      el("div", { id: "pref-color-table", class: "color-table" }),
      el("div", { class: "row", style: "margin-top:4px;" }, [el("button", { id: "pref-add-color" }, "Add color")]),
      el("div", { class: "field-label", style: "margin-top:14px;" }, "Overflow colormap"),
      el("div", { class: "pref-hint", style: "margin:0 0 6px;" }, "Gradient used when the number of series exceeds the priority colors above. Click to pick."),
      el("div", { id: "pref-cmap-list", class: "cmap-list" }),
    ]);
    pages.appendChild(page);

    $("#pref-add-color").addEventListener("click", () => {
      _colorRows.push("#000000");
      renderColorTable();
      presetSel.value = "Custom";
    });

    const cmapHost = $("#pref-cmap-list");
    CFG.FALLBACK_CMAPS.forEach((name) => {
      const row = el("div", { class: "cmap-row", "data-cmap": name }, [gradientCanvas(name), el("span", {}, name)]);
      row.addEventListener("click", () => { _selectedCmap = name; highlightCmap(); });
      cmapHost.appendChild(row);
    });
  }

  function renderColorTable() {
    const host = $("#pref-color-table");
    host.innerHTML = "";
    _colorRows.forEach((c, i) => {
      const sw = el("span", { class: "color-swatch-lg" });
      sw.style.background = c;
      const inp = el("input", { type: "text", value: c });
      inp.addEventListener("input", () => {
        _colorRows[i] = inp.value;
        sw.style.background = inp.value;
        $("#pref-preset").value = "Custom";
      });
      const rm = el("button", { class: "mini" }, "✕");
      rm.addEventListener("click", () => {
        _colorRows.splice(i, 1);
        renderColorTable();
        $("#pref-preset").value = "Custom";
      });
      host.appendChild(el("div", { class: "color-row" }, [sw, inp, rm]));
    });
  }

  function showSettingsPage(id) {
    $$("#settings-nav li").forEach((li) => li.classList.toggle("active", li.getAttribute("data-page") === id));
    $$("#settings-pages .settings-page").forEach((p) => p.classList.toggle("active", p.getAttribute("data-page") === id));
  }

  function highlightCmap() {
    $$("#pref-cmap-list .cmap-row").forEach((r) =>
      r.classList.toggle("selected", r.getAttribute("data-cmap") === _selectedCmap));
  }

  function populatePrefs() {
    const cfg = CFG.load();
    _colorRows = (cfg.priority_colors || CFG.DEFAULT_PRIORITY_COLORS).slice();
    _selectedCmap = cfg.fallback_colormap || "viridis";
    $("#pref-preset").value = cfg.color_preset || "Custom";
    const langSel = $("#pref-language");
    if (langSel) langSel.value = cfg.language || "en";
    const logChk = $("#pref-logging");
    if (logChk) logChk.checked = cfg.logging_enabled !== false;
    const logView = $("#pref-log-view");
    if (logView) { logView.value = (window.LUMOS_log && window.LUMOS_log.dump()) || ""; setTimeout(() => { logView.scrollTop = logView.scrollHeight; }, 0); }
    renderColorTable();
    highlightCmap();
  }

  function bindSettingsModal() {
    const modal = $("#settings-modal");
    buildPrefsUI();

    const open = () => { populatePrefs(); modal.classList.remove("hidden"); };
    const close = () => modal.classList.add("hidden");

    $("#btn-settings").addEventListener("click", open);
    $("#settings-cancel").addEventListener("click", close);
    $("#settings-ok").addEventListener("click", () => {
      const cols = _colorRows.map((s) => String(s).trim()).filter(Boolean);
      const prevLang = CFG.load().language || "en";
      const newLang = ($("#pref-language") || {}).value || prevLang;
      const logOn = $("#pref-logging") ? $("#pref-logging").checked : true;
      CFG.update({
        priority_colors: cols.length ? cols : CFG.DEFAULT_PRIORITY_COLORS,
        color_preset: $("#pref-preset").value,
        fallback_colormap: _selectedCmap,
        language: newLang,
        logging_enabled: logOn,
      });
      if (window.LUMOS_log) window.LUMOS_log.setEnabled(logOn);
      close();
      if (newLang !== prevLang) { window.location.reload(); return; }
      setStatus("Preferences saved.");
      for (const t of Object.values(TABS)) {
        if (t && typeof t.onSettingsChanged === "function") t.onSettingsChanged();
      }
    });
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

    const aboutModal = $("#about-modal");
    $("#btn-about").addEventListener("click", () => aboutModal.classList.remove("hidden"));
    $("#about-close").addEventListener("click", () => aboutModal.classList.add("hidden"));
    aboutModal.addEventListener("click", (e) => { if (e.target === aboutModal) aboutModal.classList.add("hidden"); });
  }

  // Mouse wheel over a focused number input nudges it by its step (clamped to
  // min/max). Focus-gated so wheeling to scroll a panel isn't hijacked.
  function enableNumberWheel() {
    document.addEventListener("wheel", (e) => {
      const t = e.target;
      if (!t || t.tagName !== "INPUT" || t.getAttribute("type") !== "number" || t.disabled) return;
      if (document.activeElement !== t) return;
      e.preventDefault();
      const step = parseFloat(t.getAttribute("step")) || 1;
      let v = parseFloat(t.value);
      if (!Number.isFinite(v)) v = 0;
      v += (e.deltaY < 0 ? 1 : -1) * step;
      const minA = t.getAttribute("min"), maxA = t.getAttribute("max");
      if (minA != null && minA !== "") v = Math.max(parseFloat(minA), v);
      if (maxA != null && maxA !== "") v = Math.min(parseFloat(maxA), v);
      const dec = (String(step).split(".")[1] || "").length;
      t.value = dec ? v.toFixed(dec) : String(v);
      t.dispatchEvent(new window.Event("input", { bubbles: true }));
      t.dispatchEvent(new window.Event("change", { bubbles: true }));
    }, { passive: false });
  }

  // Catch Ctrl/Cmd+V at the document level so it works even when nothing in the
  // app is focused (otherwise the native paste event fires and Excel's hidden
  // HTML clipboard copy can crash the renderer before any JS handler runs).
  // Skips other editable elements so normal Ctrl+V keeps working in their inputs.
  function bindGlobalPaste() {
    document.addEventListener("keydown", (e) => {
      if (!((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "v" || e.key === "V"))) return;
      if (!(navigator.clipboard && navigator.clipboard.readText)) return;
      const t = e.target;
      const editable = t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable
        || (t.tagName === "TEXTAREA" && t.id !== "dp-input" && t.id !== "map-input" && t.id !== "bp-input"));
      if (editable) return;   // don't hijack Ctrl+V in unrelated form fields
      const activeBtn = document.querySelector("#tab-bar .tab.active");
      const tabName = activeBtn && activeBtn.dataset.tab;
      const tab = TABS[tabName];
      if (!tab || typeof tab.loadFromClipboard !== "function") return;
      e.preventDefault();
      tab.loadFromClipboard();
    }, true);   // capture so we run before any element-level handler
  }

  function init() {
    if (window.LUMOS_log) {
      window.addEventListener("error", (e) => window.LUMOS_log.log("window.onerror", `${e.message || ""} @${e.filename || "?"}:${e.lineno || 0}`));
      window.addEventListener("unhandledrejection", (e) => window.LUMOS_log.log("unhandledrejection", String((e && e.reason) || "")));
      window.LUMOS_log.log("app init");
    }
    bindTabBar();
    bindSettingsModal();
    enableNumberWheel();
    bindGlobalPaste();
    if (window.LUMOS_i18n) window.LUMOS_i18n.init();
    activateTab("plot");
    setStatus("Ready. Paste data with Ctrl+V or use the controls.");
  }

  document.addEventListener("DOMContentLoaded", init);
})();

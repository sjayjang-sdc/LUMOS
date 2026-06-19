// localStorage-backed key/value config — mirrors LUMOS_config.py
// at a smaller scale. Each tab persists its own ``*_settings`` blob.
"use strict";

const STORAGE_KEY = "lumos_config_v1";

// Built-in priority-color presets (mirrors LUMOS_main.py SettingsDialog).
const COLOR_PRESETS = {
  "Tableau (10)": [
    "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F",
    "#EDC948", "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC",
  ],
  "Jay (7)": ["black", "red", "blue", "green", "purple", "cyan", "yellow"],
  "Vivid (10)": [
    "#1B9E77", "#D95F02", "#7570B3", "#E7298A", "#66A61E",
    "#E6AB02", "#A6761D", "#666666", "#1F78B4", "#33A02C",
  ],
};

// Colormaps usable as the "overflow" gradient when the number of series
// exceeds the priority-color palette length (must exist in LUMOS_plotting.CMAPS).
const FALLBACK_CMAPS = ["viridis", "plasma", "inferno", "magma", "cividis", "coolwarm", "turbo", "jet", "gray"];

const DEFAULT_PRIORITY_COLORS = COLOR_PRESETS["Tableau (10)"];

const DEFAULTS = {
  language: "en",             // UI language: "en" | "ko"
  logging_enabled: false,     // diagnostic logging to localStorage (off by default)
  plot_columns: 2,
  subplot_size: [500, 400],   // pixels in browser
  priority_colors: DEFAULT_PRIORITY_COLORS,
  color_preset: "Tableau (10)",
  fallback_colormap: "viridis",
  // Data Plot display settings (all styling lives here, edited in Preferences).
  plot_settings: {
    style: "both",                 // line | markers | both
    line_width: 1.6,
    marker_size: 3,
    marker_fill: "filled",         // filled | hollow
    marker_outline: false,         // draw outline when filled
    marker_outline_color: "#000000", // global outline color (filled + outline)
    xlim_min: "",                  // axis limits ("" = auto, data units)
    xlim_max: "",
    ylim_min: "",
    ylim_max: "",
    log_x: false,
    log_y: false,
    show_grid: true,
    show_legend: true,
    legend_loc: "upper right",
    legend_font: "system-ui",
    legend_font_size: 11,
    legend_bold: false,
    legend_italic: false,
    tick_font: "system-ui",
    tick_font_size: 11,
    tick_bold: false,
    tick_italic: false,
    title_font: "system-ui",
    title_font_size: 12,
    title_bold: false,
    title_italic: false,
    frame_line_width: 1,
    tick_line_width: 1,
  },
  map_settings: {
    swap_xy: false,
    value_show: false,
    value_fontsize: 11,
    value_color: "#ffffff",
    value_bold: true,
    value_auto_inward: true,
    value_decimals: 3,
    point_show: true,
    point_size: 3,
    point_fill: "#111111",
    point_outline: true,
    point_outline_color: "#ffffff",
    colormap: "viridis",
    interpolation_method: "rbf_multiquadric",
    idw_smoothing: 0.05,
    show_contour_lines: true,
    hide_ticks: false,
    tick_font: "system-ui",
    tick_font_size: 11,
    tick_bold: false,
    frame_line_width: 1,
    legend_style: "bar",
    legend_font: "system-ui",
    legend_font_size: 10,
    legend_bold: false,
    plot_size: 100,
    map_columns: 2,
    table_view: "2D",
    snap_coords_enabled: false,
    snap_mode: "Round",
    round_x_decimals: 0,
    round_y_decimals: 0,
  },
  boxplot_settings: {
    mode: "wide",
    box_width: 0.6,
    box_color: "#ADD8E6",
    use_color_sequence: false,
    show_jitter: true,
    show_mean: true,
    show_outliers: true,
    log_y: false,
    show_grid: true,
    tick_font: "system-ui",
    tick_size: 11,
    tick_bold: false,
    xlabel_rot: "auto",
    label_font: "system-ui",
    label_size: 13,
    label_bold: false,
    split_layout: "side",
    legend_loc: "upper right",
    legend_font: "system-ui",
    legend_size: 11,
    frame_line_width: 1,
    xlabel: "",
    ylabel: "",
    canvas_width: "",
    canvas_height: "",
    subplot_cols: 2,
    ylim_min: "",
    ylim_max: "",
  },
  boxplot_colors: ["#377eb8", "#ff7f00", "#4daf4a", "#f781bf", "#a65628", "#984ea3"],
  digitizer_settings: {
    // Levels
    auto_invert: false,
    levels_black: 0,
    levels_white: 255,
    levels_gamma: 1.0,
    // Grid removal
    remove_grid: true,
    grid_line_length: 20,
    grid_thickness: 2,
    grid_threshold: 0,
    // Line detection
    color_tolerance: 30,
    band_width: 6,
    keep_largest: false,
    // Output
    output_mode: "line",
    point_step: 1,
    min_symbol_area: 5,
    split_symbols: true,
    symbol_size: 12,
    // Region
    brush_radius: 15,
    // Result overlay style
    overlay_color: "#1d4ed8",
    overlay_line_width: 2,
    overlay_marker_size: 4,
    // View toggle
    view: "Original",
  },
  map_rbf_grid_resolution: 150,
  map_rbf_max_points: 200,
};

function deepCopy(v) {
  return JSON.parse(JSON.stringify(v));
}

function loadConfig() {
  let stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch (e) {
    console.warn("Bad stored config; using defaults.", e);
    stored = {};
  }
  // Merge defaults with stored (shallow for top-level, deep for known dicts).
  const out = deepCopy(DEFAULTS);
  for (const k of Object.keys(stored)) {
    const v = stored[k];
    if (k.endsWith("_settings") && v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function saveConfig(patch) {
  // Merge patch into stored config.
  const cur = loadConfig();
  for (const k of Object.keys(patch)) {
    cur[k] = patch[k];
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cur));
  } catch (e) {
    console.warn("Failed to save config:", e);
  }
}

function updateConfig(patch) {
  saveConfig(patch);
}

window.LUMOS_config = {
  DEFAULTS,
  DEFAULT_PRIORITY_COLORS,
  COLOR_PRESETS,
  FALLBACK_CMAPS,
  load: loadConfig,
  save: saveConfig,
  update: updateConfig,
};

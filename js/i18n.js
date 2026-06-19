// Lightweight UI localization. The whole app is authored in English; when the
// language is Korean we translate the built DOM in place via a dictionary and
// keep a MutationObserver running so lazily-built tabs and re-rendered content
// get translated too. Proper nouns (RBF, IDW, colormap / font names) are left
// out of the dictionary so they pass through untouched.
"use strict";

(function () {
  const KO = {
    // Shell / tabs
    "Data plot": "데이터 플롯", "Map Generator": "맵 생성기", "Box Plot": "박스 플롯", "Digitizer": "디지타이저",
    "Preferences": "환경설정", "About": "정보", "Ready": "준비됨",
    "Cancel": "취소", "Save": "저장", "Close": "닫기", "Apply": "적용",
    "About LUMOS Browser": "LUMOS 브라우저 정보",
    // Settings
    "Colors": "색상", "General": "일반", "Language": "언어", "Preset": "프리셋",
    "Add color": "색상 추가", "Overflow colormap": "오버플로 컬러맵",
    "Priority colors (top = highest priority)": "우선순위 색상 (위 = 최우선)",
    "Preferences saved.": "환경설정이 저장되었습니다.",
    // Nav / sections / panes
    "Data": "데이터", "Interpolation": "보간", "Style": "스타일", "Mode": "모드", "Columns": "컬럼",
    "Image": "이미지", "Calibration": "보정", "Preprocess": "전처리", "Region": "영역", "Result": "결과",
    "Map": "맵", "Table": "표", "Plot": "플롯", "Stats": "통계",
    // Block titles
    "Boxes": "박스", "Box split": "박스 분할", "Legend": "범례", "Axes & font": "축 & 글꼴",
    "Labels": "라벨", "Canvas": "캔버스", "Y limits": "Y 범위", "Overlays": "오버레이",
    "Colormap": "컬러맵", "Color range": "색상 범위", "Layout": "레이아웃", "Points": "포인트",
    "Values": "값", "Snap coords": "좌표 스냅", "Levels": "레벨", "Grid removal": "격자 제거",
    "Line detection": "선 검출", "Output": "출력", "Brush mask": "브러시 마스크",
    "Overlay style": "오버레이 스타일", "Format": "형식", "Source": "소스",
    "Pick points": "점 선택", "Values & pixels": "값 & 픽셀", "Series": "계열", "Axis": "축",
    "Filter": "필터", "X / Y handling": "X / Y 처리", "Axis limits": "축 범위",
    // Field labels
    "Method": "방법", "IDW smoothing": "IDW 평활", "Round X": "X 반올림", "Round Y": "Y 반올림",
    "Scheme": "구성표", "Min": "최소", "Max": "최대", "Position": "위치", "Font": "글꼴", "Size": "크기",
    "Color": "색상", "Decimals": "소수 자릿수",
    "Legend font": "범례 글꼴", "Legend size": "범례 크기", "Legend bold": "범례 굵게", "Legend italic": "범례 기울임",
    "Tick font": "눈금 글꼴", "Tick size": "눈금 크기", "Tick bold": "눈금 굵게", "Tick italic": "눈금 기울임",
    "Frame width": "테두리 두께", "Frame line width": "테두리 선 두께", "Tick line width": "눈금 선 두께",
    "Label font": "라벨 글꼴", "Label size": "라벨 크기", "Label bold": "라벨 굵게",
    "Title font": "제목 글꼴", "Title size": "제목 크기", "Title bold": "제목 굵게", "Title italic": "제목 기울임",
    "Point size": "점 크기", "Point fill": "점 채움", "Point outline": "점 외곽선", "Outline color": "외곽선 색",
    "Box width": "박스 너비", "Box color": "박스 색상",
    "X label": "X 라벨", "Y label": "Y 라벨", "X label angle": "X 라벨 각도",
    "Width": "너비", "Height": "높이", "Subplot cols": "서브플롯 열", "Subplot width": "서브플롯 너비",
    "Subplot height": "서브플롯 높이", "Grid columns": "격자 열",
    "Marker style": "마커 스타일", "Marker fill": "마커 채움", "Marker size": "마커 크기", "Line width": "선 두께",
    "X min": "X 최소", "X max": "X 최대", "Y min": "Y 최소", "Y max": "Y 최대",
    "X title": "X 제목", "Y title": "Y 제목",
    "Override the auto axis title for all subplots (empty = auto; common prefix is used when columns differ).": "모든 서브플롯의 축 제목을 강제로 지정합니다(비우면 자동 — 컬럼이 다르면 공통 접두어 사용).",
    "Value": "값", "Group (X)": "그룹 (X)", "Split layout": "분할 레이아웃",
    "Black": "검정점", "White": "흰점", "Gamma": "감마", "Min length": "최소 길이",
    "Thickness": "두께", "Threshold": "임계값", "Color tol": "색 허용오차", "Band width": "밴드 폭",
    "Point spacing": "점 간격", "Min symbol area": "최소 심볼 면적", "Symbol size": "심볼 크기",
    "Brush size": "브러시 크기", "Box split": "박스 분할",
    // Checkboxes / radios
    "Contour lines": "등고선", "Manual min / max": "수동 최소 / 최대", "Hide ticks": "눈금 숨김",
    "Swap X / Y": "X / Y 교환", "Show data points": "데이터 점 표시", "Show values": "값 표시",
    "Push inward at edges": "가장자리 안쪽 배치", "Bold": "굵게", "Show legend": "범례 표시",
    "Jitter points": "지터 점", "Mean marker": "평균 마커", "Outliers (1.5·IQR whiskers)": "이상치 (1.5·IQR 수염)",
    "Use color sequence (palette)": "색상 시퀀스 사용 (팔레트)", "Enable snap": "스냅 사용",
    "Auto-invert if dark background": "어두운 배경이면 자동 반전", "Remove grid lines": "격자선 제거",
    "Keep only largest blob": "가장 큰 덩어리만 유지", "Split touching symbols": "맞닿은 심볼 분리",
    "Outline (filled)": "외곽선 (채움)", "Grid": "격자",
    // Radio / option values
    "Wide (columns)": "와이드 (열)", "Long (group / value)": "롱 (그룹 / 값)",
    "Bar": "막대", "Split": "분할", "Off": "끔", "Auto": "자동",
    "Horizontal": "수평", "Vertical (90°)": "수직 (90°)", "Diagonal (45°)": "대각 (45°)",
    "Side-by-side boxes": "나란한 박스", "Subplots": "서브플롯",
    "Line trace": "선 추적", "Symbol centroids": "심볼 중심",
    "2D pivot": "2D 피벗", "2D": "2D", "3-Col (x, y, z…)": "3열 (x, y, z…)", "3-Col": "3열",
    "Original": "원본", "Preprocessed": "전처리됨", "Grid detection": "격자 검출",
    "filled": "채움", "hollow": "속 빈", "filled + outline": "채움 + 외곽선",
    // Buttons
    "Load / Paste": "불러오기 / 붙여넣기", "Reset": "초기화", "Copy": "복사", "Copy table": "표 복사",
    "Copy image": "이미지 복사", "Save CSV": "CSV 저장", "Save PNG": "PNG 저장",
    "Load image…": "이미지 불러오기…", "Paste (Ctrl+V)": "붙여넣기 (Ctrl+V)",
    "Pick X": "X 선택", "Pick Y": "Y 선택", "Pick line color": "선 색 선택",
    "Clear": "지우기", "Clear X": "X 지우기", "Clear Y": "Y 지우기", "Clear filter": "필터 지우기",
    "Reset all": "전체 초기화", "Reset levels": "레벨 초기화",
    "Reset preprocess to defaults": "전처리 기본값으로 초기화", "Extract Data": "데이터 추출",
    "Brush": "브러시", "Eraser": "지우개", "Fit": "맞춤", "Filter…": "필터…", "Stats": "통계",
    // Dynamic table headers / stats
    "Group": "그룹", "Mean": "평균", "Median": "중앙값", "Std": "표준편차", "Unif%": "균일%",
    "avg": "평균", "max": "최대", "min": "최소", "range": "범위", "std": "표준편차", "unif (%)": "균일 (%)",
    // Common placeholders
    "auto": "자동", "(none)": "(없음)", "value": "값",
    // Plot modes / reference splits
    "Single-X (overlay / ref)": "단일 X (오버레이 / 기준)",
    "Multiple X (subplots by X)": "다중 X (X별 서브플롯)",
    "Paired X/Y (multi-set)": "쌍 X/Y (다중 세트)",
    "Sets": "세트", "+ Add set": "+ 세트 추가",
    "Each set is one (X, Y) curve. Multiple sets overlay on one plot.": "각 세트는 하나의 (X, Y) 곡선입니다. 여러 세트를 한 플롯에 겹쳐 그립니다.",
    "Click “+ Add set” to begin.": "“+ 세트 추가”를 눌러 시작하세요.",
    "Disabled in Paired X/Y mode — each set already pairs its own X with its Y.": "쌍 X/Y 모드에서는 사용할 수 없음 — 각 세트가 자체 X와 Y를 짝지어 가집니다.",
    "Overlay all Y": "모든 Y 겹쳐 그리기", "Subplots per Y": "Y별 서브플롯",
    "Plot Ref (split canvas)": "Plot Ref (캔버스 분할)", "Color Ref (split color)": "Color Ref (색 분할)",
    "Show ghost": "고스트 표시",
    // Field labels / misc
    "X columns": "X 컬럼", "Y columns": "Y 컬럼", "Value columns": "값 컬럼", "Filter column": "필터 컬럼",
    "Per-group statistics": "그룹별 통계", "Statistics": "통계",
    // Hints / descriptions
    "Paste TSV/CSV (Ctrl+V). Header row recommended.": "TSV/CSV 붙여넣기 (Ctrl+V). 헤더 행 권장.",
    "Paste TSV/CSV. Wide = columns of values; Long = (group, value [, split]) rows.": "TSV/CSV 붙여넣기. 와이드 = 값들의 열; 롱 = (그룹, 값 [, 분할]) 행.",
    "Paste (Ctrl+V): 3-col (x, y, z) or 2D pivot table.": "붙여넣기 (Ctrl+V): 3열 (x, y, z) 또는 2D 피벗 표.",
    "Plots update automatically. Each plot has its own Copy button (top-right).": "플롯은 자동으로 갱신됩니다. 각 플롯에는 우상단에 Copy 버튼이 있습니다.",
    "Each plot has its own Copy / Save button (top-right).": "각 플롯에는 우상단에 Copy / Save 버튼이 있습니다.",
    "Each map has its own Copy / Save button (top-right).": "각 맵에는 우상단에 Copy / Save 버튼이 있습니다.",
    "Limits empty = auto. Data units (log axes accept the raw value).": "범위 비우면 자동. 데이터 단위(로그 축은 원래 값 입력).",
    "Hollow outline follows the series color; filled outline uses the color above.": "속 빈 외곽선은 계열 색을 따르고, 채움 외곽선은 위 색을 사용합니다.",
    "Included = plotted normally. Excluded = ghost (faint, shown when 'Show ghost' is on). Click a value to move it between sides.": "포함 = 정상 표시. 제외 = 고스트(흐리게, 'Show ghost' 켜면 표시). 값을 클릭하면 양쪽으로 이동합니다.",
    "No filter.": "필터 없음.",
    "RBF auto-falls back to IDW above ~200 points. IDW smoothing only affects IDW.": "RBF는 약 200점 초과 시 자동으로 IDW로 전환됩니다. IDW 평활은 IDW에만 적용됩니다.",
    "0 = Off. Positive N drops N trailing integer digits (μm coords); negative N keeps |N| decimals.": "0 = 끔. 양수 N은 정수 끝 N자리를 버림(μm 좌표용); 음수 N은 소수 |N|자리 유지.",
    "Multiple Z columns (x, y, z1, z2, …) draw one map each; Columns sets the grid width.": "여러 Z 열(x, y, z1, z2, …)은 각각 하나의 맵으로 그려지며, Columns가 격자 너비를 정합니다.",
    "Decimal places for value labels and the legend.": "값 라벨과 범례의 소수 자릿수.",
    "For side-by-side box split (drawn inside the plot).": "나란한 박스 분할용(플롯 안쪽에 그려짐).",
    "Box split adds sub-boxes per value (≤ 6); ≤ 60 X groups.": "박스 분할은 값마다 서브박스를 추가합니다 (≤ 6); X 그룹 ≤ 60.",
    "Click two X-axis ticks, then two Y-axis ticks. Drag markers to fine-tune.": "X축 눈금 2개를 찍은 뒤 Y축 눈금 2개를 찍으세요. 마커를 드래그해 미세 조정.",
    "Drag & drop a file onto the canvas, or press Ctrl+V.": "캔버스에 파일을 끌어다 놓거나 Ctrl+V를 누르세요.",
    "Pull White down to fade faint grids while keeping data dark.": "흰점을 내리면 희미한 격자는 흐려지고 데이터는 어둡게 유지됩니다.",
    "Threshold 0 = auto (Otsu).": "임계값 0 = 자동 (Otsu).",
    "Band width = grayscale tolerance around the detected line shade (color sensitivity), not point count.": "밴드 폭 = 검출된 선 명암 주변의 회색조 허용폭(색 민감도)이며, 점 개수가 아님.",
    "Line trace: one point per N pixel columns — 1 = densest, larger = sparser.": "선 추적: N 픽셀 열마다 1점 — 1 = 가장 촘촘, 클수록 듬성.",
    "Symbols: splits overlapping filled markers into one point each. Symbol size ≈ marker diameter (px).": "심볼: 겹친 채움 마커를 각각 하나의 점으로 분리합니다. 심볼 크기 ≈ 마커 지름(px).",
    "How the extracted trajectory is drawn over the image. Line trace draws a connected line; symbols draw circles.": "추출된 궤적을 이미지 위에 그리는 방식. 선 추적은 연결된 선을, 심볼은 원을 그립니다.",
    "Paint to keep only the brushed region; erase to remove. Intersected with the calibration bbox at extract time.": "칠한 영역만 남기고, 지우개로 제거. 추출 시 보정 bbox와 교집합으로 적용됩니다.",
    "Preprocess settings are remembered between sessions; this restores the defaults.": "전처리 설정은 세션 간 기억됩니다; 이 버튼은 기본값을 복원합니다.",
    "Changing the language reloads the app.": "언어를 변경하면 앱이 새로고침됩니다.",
    "Gradient used when the number of series exceeds the priority colors above. Click to pick.": "계열 수가 위 우선순위 색을 초과할 때 쓰는 그라디언트입니다. 클릭해 선택하세요.",
    "<no image>": "<이미지 없음>",
    // Buttons / labels (recent)
    "Paste from clipboard": "클립보드에서 붙여넣기", "Load textarea": "텍스트 불러오기",
    "Reference split": "기준 분할", "Included (target)": "포함 (대상)", "Excluded (ghost)": "제외 (고스트)",
    "all ⟶": "전체 ⟶", "⟵ all": "⟵ 전체",
    "Extracted data": "추출된 데이터", "Drop image here": "여기에 이미지를 놓으세요",
    "Custom": "사용자 지정", "Round": "반올림", "Truncate": "버림", "mean": "평균",
    "Upper right": "우상단", "Upper left": "좌상단", "Lower right": "우하단", "Lower left": "좌하단",
    "Download log": "로그 다운로드", "Copy log": "로그 복사", "Clear log": "로그 지우기",
    "Enable diagnostic logging": "진단 로깅 사용",
    // Hints (recent)
    "Paste TSV/CSV. Header row recommended.": "TSV/CSV 붙여넣기. 헤더 행 권장.",
    "3-col (x, y, z1, z2…) or 2D pivot table.": "3열 (x, y, z1, z2…) 또는 2D 피벗 표.",
    "For large Excel data use “Paste from clipboard” (Ctrl+V can choke on Excel’s hidden HTML copy).": "큰 Excel 데이터는 “클립보드에서 붙여넣기”를 쓰세요 (Ctrl+V는 Excel의 숨은 HTML 복사본 때문에 멈출 수 있음).",
    "For large Excel data, use “Paste from clipboard” — Ctrl+V can choke on Excel’s hidden HTML copy.": "큰 Excel 데이터는 “클립보드에서 붙여넣기”를 쓰세요 — Ctrl+V는 Excel의 숨은 HTML 복사본 때문에 멈출 수 있음.",
    "Logs (incl. memory use) survive a crash. The lines just above the last “session start” are the crashed run.": "로그(메모리 사용량 포함)는 크래시에도 보존됩니다. 마지막 “session start” 바로 위 줄들이 크래시 직전 기록입니다.",
    // About modal
    "Logical Understanding & Modeling Optimized System": "논리적 이해 및 모델링 최적화 시스템",
    "No-install, in-browser data visualisation. Vanilla HTML/CSS/JS, no build step, no external libraries.": "설치 없이 브라우저에서 바로 쓰는 데이터 시각화 도구. Vanilla HTML/CSS/JS, 빌드·외부 라이브러리 없음.",
    "Data plot — multi-subplot scatter / line from pasted TSV": "Data plot — 붙여넣은 TSV로 다중 서브플롯 산점/선 그래프",
    "Map Generator — RBF / IDW interpolation, contour heatmap, stats (multi-Z)": "Map Generator — RBF / IDW 보간, 등고선 히트맵, 통계 (다중 Z)",
    "Box Plot — box plots with outliers, group split, stats table": "Box Plot — 이상치·그룹 분할·통계표가 있는 박스플롯",
    "Digitizer — plot image to data, with calibration / brush / colour pick": "Digitizer — 플롯 이미지 → 데이터 추출 (보정 / 브러시 / 색 선택)",
    "Made by": "제작", "Named by": "작명",
    // Status (recent)
    "Log cleared.": "로그를 지웠습니다.", "Log copied.": "로그를 복사했습니다.",
    "Clipboard read blocked (needs HTTPS / permission).": "클립보드 읽기가 차단됨 (HTTPS / 권한 필요).",
    "Clipboard has no text (or permission denied).": "클립보드에 텍스트가 없습니다 (또는 권한 거부).",
    // Status-bar messages (static)
    "Ready": "준비됨",
    "Ready. Paste data with Ctrl+V or use the controls.": "준비됨. Ctrl+V로 데이터를 붙여넣거나 컨트롤을 사용하세요.",
    "Preferences saved.": "환경설정이 저장되었습니다.",
    "Plot cleared.": "플롯을 지웠습니다.", "Map cleared.": "맵을 지웠습니다.", "Boxplot cleared.": "박스플롯을 지웠습니다.",
    "Plot copied to clipboard.": "플롯을 클립보드에 복사했습니다.", "Map copied to clipboard.": "맵을 클립보드에 복사했습니다.",
    "Boxplot copied to clipboard.": "박스플롯을 클립보드에 복사했습니다.",
    "Table copied.": "표를 복사했습니다.", "Stats copied.": "통계를 복사했습니다.",
    "Copy failed.": "복사 실패.", "Copy failed (needs HTTPS / clipboard permission).": "복사 실패 (HTTPS / 클립보드 권한 필요).",
    "Image clipboard copy isn't supported in this browser.": "이 브라우저에서는 이미지 클립보드 복사를 지원하지 않습니다.",
    "Result copied as TSV.": "결과를 TSV로 복사했습니다.", "Result saved.": "결과를 저장했습니다.",
    "Image loaded.": "이미지를 불러왔습니다.", "Load an image first.": "먼저 이미지를 불러오세요.",
    "Load data first.": "먼저 데이터를 불러오세요.", "Loading data…": "데이터 불러오는 중…",
    "Clipboard has no image.": "클립보드에 이미지가 없습니다.",
    "Select at least one X and one Y column (Columns section).": "X와 Y 컬럼을 각각 하나 이상 선택하세요 (Columns 섹션).",
    "Select at least one column / group.": "컬럼 / 그룹을 하나 이상 선택하세요.",
    "No numeric values.": "숫자 값이 없습니다.", "Need at least 3 valid points to interpolate.": "보간하려면 유효한 점이 3개 이상 필요합니다.",
    "Log Y needs all values > 0.": "로그 Y는 모든 값이 0보다 커야 합니다.",
    "Log X requires positive values.": "로그 X는 양수 값이 필요합니다.", "Log Y requires positive values.": "로그 Y는 양수 값이 필요합니다.",
    "X cal values must differ.": "X 보정 값이 서로 달라야 합니다.", "Y cal values must differ.": "Y 보정 값이 서로 달라야 합니다.",
    "Bad bbox.": "잘못된 bbox.", "Cal bbox too tight.": "보정 bbox가 너무 좁습니다.",
    "Extraction produced 0 points.": "추출된 점이 0개입니다.",
    "Extracted result cleared — adjust settings and extract again.": "추출 결과를 지웠습니다 — 설정을 바꿔 다시 추출하세요.",
    "Preprocess settings reset to defaults.": "전처리 설정을 기본값으로 되돌렸습니다.",
    "Filter not applied: nothing in Included.": "필터 미적용: 포함 목록이 비어 있습니다.",
    "No trajectory color detected.": "궤적 색을 검출하지 못했습니다.",
    "No trajectory color detected. Try Pick line color, or widen the bbox.": "궤적 색을 검출하지 못했습니다. 선 색 선택을 쓰거나 bbox를 넓혀보세요.",
  };

  // Templates for interpolated status messages (Korean only).
  const MSG_PATTERNS = [
    [/^Loaded (\d+) rows × (\d+) columns\. Pick X \/ Y in the Columns section\.$/, (m) => `${m[1]}행 × ${m[2]}열 불러옴. Columns 섹션에서 X / Y를 선택하세요.`],
    [/^Loaded (\d+) rows × (\d+) columns\. Pick columns \/ group in the Columns section\.$/, (m) => `${m[1]}행 × ${m[2]}열 불러옴. Columns 섹션에서 컬럼 / 그룹을 선택하세요.`],
    [/^Loaded (\d+) rows × (\d+) columns\.(.*)$/, (m) => `${m[1]}행 × ${m[2]}열 불러옴.${m[3]}`],
    [/^Loaded (\d+) map\(s\), (\d+) points\.$/, (m) => `맵 ${m[1]}개, 점 ${m[2]}개 불러옴.`],
    [/^Plotted (\d+) subplot\(s\)\.$/, (m) => `서브플롯 ${m[1]}개를 그렸습니다.`],
    [/^Extracted (\d+) points\.$/, (m) => `점 ${m[1]}개를 추출했습니다.`],
    [/^Auto-fallback: (\d+) points > (\d+), using IDW\.$/, (m) => `자동 전환: 점 ${m[1]}개 > ${m[2]}, IDW 사용.`],
    [/^Both (.+) points already set\. Drag to move\.$/, (m) => `${m[1]} 점이 이미 설정됨. 드래그해서 이동하세요.`],
    [/^Interpolation failed: (.*)$/, (m) => `보간 실패: ${m[1]}`],
    [/^Parse error: (.*)$/, (m) => `파싱 오류: ${m[1]}`],
    [/^Need all 4 calibration points \+ values: (.*)$/, (m) => `4개 보정점 + 값이 모두 필요합니다: ${m[1]}`],
  ];

  const DICTS = { ko: KO };
  let LANG = "en";
  let DICT = null;

  function readLang() {
    try { return (window.LUMOS_config && window.LUMOS_config.load().language) || "en"; }
    catch (e) { return "en"; }
  }

  function translateText(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2];
    if (!core) return s;
    const tr = DICT && DICT[core];
    return tr ? m[1] + tr + m[3] : s;
  }

  // Translate a node and its descendants in place (text nodes + placeholder /
  // title attributes). Idempotent: Korean output isn't a dictionary key.
  function apply(node) {
    if (!DICT || !node) return;
    if (node.nodeType === 3) {
      const v = translateText(node.nodeValue || "");
      if (v !== node.nodeValue) node.nodeValue = v;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.getAttribute) {
      for (const a of ["placeholder", "title"]) {
        const val = node.getAttribute(a);
        if (val && DICT[val.trim()]) node.setAttribute(a, DICT[val.trim()]);
      }
    }
    const kids = node.childNodes;
    if (kids) for (let i = 0; i < kids.length; i++) apply(kids[i]);
  }

  function init() {
    LANG = readLang();
    DICT = DICTS[LANG] || null;
    if (!DICT) return;                       // English: nothing to do
    if (typeof document !== "undefined" && document.body) apply(document.body);
    if (typeof MutationObserver !== "undefined" && document.body) {
      const obs = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) apply(n);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Translate a status-bar message: exact dictionary match, then interpolated
  // templates, else the original (English) text.
  function msg(s) {
    if (!DICT || s == null) return s;
    if (DICT[s]) return DICT[s];
    const core = String(s).trim();
    if (DICT[core]) return DICT[core];
    for (const [re, fn] of MSG_PATTERNS) { const m = re.exec(s); if (m) return fn(m); }
    return s;
  }

  window.LUMOS_i18n = {
    init,
    apply,
    msg,
    t: (s) => (DICT && DICT[s]) || s,
    lang: () => LANG,
    LANGS: [["en", "English"], ["ko", "한국어"]],
  };
})();

// @id beatoraja

/**
 * beatoraja / lr2oraja / Qwilight Now Playing Plugin
 *
 * beatoraja, lr2oraja, Qwilight 등에서 선곡·플레이 중인 곡 정보를 DmNote 패널에 표시합니다.
 */

// ── 브릿지 연결 확인 및 자동 실행 ────────────────────────────────────────────

async function _isBridgeAlreadyRunning() {
  const base = _getBase();
  try {
    const res = await fetch(`${base}/state`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function _getMyPluginPath() {
  try {
    const jsData = await window.api.js.get();
    const me = jsData.plugins.find(p => p.name === "beatoraja.js");
    return me?.path || null;
  } catch {
    return null;
  }
}

function _deriveBatPath(pluginPath) {
  const dir = pluginPath.replace(/[/\\][^/\\]+$/, "");
  return dir + "\\beatoraja-bridge\\start.bat";
}

async function _launchBridge() {
  const pluginPath = await _getMyPluginPath();
  if (!pluginPath) return false;
  try {
    await window.api.app.openExternal(_deriveBatPath(pluginPath));
    return true;
  } catch {
    return false;
  }
}

async function _ensureBridge() {
  if (await _isBridgeAlreadyRunning()) return true;
  const launched = await _launchBridge();
  if (!launched) return false;
  for (let i = 0; i < 16; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await _isBridgeAlreadyRunning()) return true;
  }
  return false;
}

// ── 서버 설정 (우클릭 → 서버 설정) ──────────────────────────────────────────

const _globalSettings = dmn.plugin.defineSettings({
  settingsUI: "panel",
  settings: {
    bridgeUrl: {
      type: "string",
      default: "",
      label: "settings.bridgeUrl",
      placeholder: "settings.bridgeUrl.placeholder",
    },
    bridgePort: {
      type: "number",
      default: 54321,
      min: 1,
      max: 65535,
      label: "settings.bridgePort",
    },
    pollInterval: {
      type: "number",
      default: 2,
      min: 1,
      max: 30,
      label: "settings.pollInterval",
    },
    _s1: { type: "divider" },
    game: {
      type: "select",
      default: "beatoraja",
      label: "settings.game",
      options: [
        { value: "beatoraja", label: "settings.game.beatoraja" },
        { value: "qwilight",  label: "settings.game.qwilight" },
      ],
    },
    detectionMethod: {
      type: "select",
      default: "sqlite",
      label: "settings.detectionMethod",
      when: { key: "game", not: "qwilight" },
      options: [
        { value: "sqlite",     label: "settings.method.sqlite" },
        { value: "lua+sqlite", label: "settings.method.lua" },
        { value: "custom-api", label: "settings.method.custom" },
      ],
    },
    gameDir: {
      type: "string",
      default: "",
      label: "settings.gameDir",
      placeholder: "settings.gameDir.placeholder",
    },
    luaStatePath: {
      type: "string",
      default: "",
      label: "settings.luaStatePath",
      placeholder: "settings.luaStatePath.placeholder",
      when: { key: "game", not: "qwilight" },
    },
    customApiUrl: {
      type: "string",
      default: "",
      label: "settings.customApiUrl",
      placeholder: "settings.customApiUrl.placeholder",
      when: { key: "game", not: "qwilight" },
    },
    _s2: { type: "divider", when: { key: "game", not: "qwilight" } },
    hookUpdateRate: {
      type: "number",
      default: 2,
      label: "settings.hookUpdateRate",
      when: { key: "game", not: "qwilight" },
      min: 1,
      max: 10,
    },
  },
  messages: {
    en: {
      "settings.bridgeUrl":               "Host",
      "settings.bridgeUrl.placeholder":   "http://localhost",
      "settings.bridgePort":              "Port",
      "settings.pollInterval":            "Poll (sec)",
      "settings.game":                    "Game",
      "settings.game.beatoraja":          "beatoraja / lr2oraja",
      "settings.game.qwilight":           "Qwilight",
      "settings.detectionMethod":         "Method",
      "settings.method.sqlite":           "SQLite",
      "settings.method.lua":              "Lua + SQLite",
      "settings.method.custom":           "Custom API",
      "settings.gameDir":            "Path",
      "settings.gameDir.placeholder":"auto-detect",
      "settings.luaStatePath":            "Lua File",
      "settings.luaStatePath.placeholder":"auto",
      "settings.customApiUrl":            "API URL",
      "settings.customApiUrl.placeholder":"http://...",
      "settings.hookUpdateRate":          "Hook Rate",
    },
    ko: {
      "settings.bridgeUrl":               "호스트",
      "settings.bridgeUrl.placeholder":   "http://localhost",
      "settings.bridgePort":              "포트",
      "settings.pollInterval":            "폴링 (초)",
      "settings.game":                    "구동기",
      "settings.game.beatoraja":          "beatoraja / lr2oraja",
      "settings.game.qwilight":           "Qwilight",
      "settings.detectionMethod":         "탐지",
      "settings.method.sqlite":           "SQLite",
      "settings.method.lua":              "Lua + SQLite",
      "settings.method.custom":           "커스텀 API",
      "settings.gameDir":            "경로",
      "settings.gameDir.placeholder":"자동 탐지",
      "settings.luaStatePath":            "Lua 파일",
      "settings.luaStatePath.placeholder":"자동",
      "settings.customApiUrl":            "API URL",
      "settings.customApiUrl.placeholder":"http://...",
      "settings.hookUpdateRate":          "훅 빈도",
    },
  },
});

// ── 마이그레이션: beatorajaDir → gameDir ──────────────────────────────────────
{
  const _gs = _globalSettings.get();
  if (_gs.beatorajaDir && !_gs.gameDir) {
    _globalSettings.set({ gameDir: _gs.beatorajaDir });
  }
}

// ── 공통 헬퍼 ────────────────────────────────────────────────────────────────

function _rgba(hex, alpha) {
  if (!hex || hex.charAt(0) !== "#") return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function _clearStyle(clear, fallbackColor) {
  const map = {
    "FAILED": "#EF4444", "F": "#EF4444",
    "FC": "#FFD700", "PERFECT": "#FFD700", "MAX": "#FFD700",
    "S+": "#FFD700", "S": "#FFD700",
    "A+": "#4ADE80", "A": "#4ADE80",
    "B": "#60A5FA",
    "C": "#9CA3AF", "D": "#9CA3AF",
  };
  return map[clear] || fallbackColor;
}

const SIZE_MAP = {
  small:  { title: 12, artist: 9,  info: 9,  player: 10, dim: 8,  badge: 8  },
  medium: { title: 14, artist: 10, info: 10, player: 12, dim: 9,  badge: 9  },
  large:  { title: 17, artist: 12, info: 12, player: 14, dim: 10, badge: 10 },
};

// ── 폴링 상태 ────────────────────────────────────────────────────────────────

let _pollTimer = null;
let _connected = false;
let _data = null;
let _setState = null;
let _setupAttempted = false;
let _autoLaunchAttempted = false;

function _getBase() {
  const gs = _globalSettings.get();
  const host = (gs.bridgeUrl || "http://localhost").replace(/\/$/, "");
  const port = gs.bridgePort || 54321;
  return `${host}:${port}`;
}

function _pushConfig() {
  const gs = _globalSettings.get();
  const base = _getBase();
  fetch(`${base}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      game:         gs.game             || "beatoraja",
      method:       gs.detectionMethod  || "sqlite",
      dir:          gs.gameDir           || "",
      luaStatePath: gs.luaStatePath     || "",
      customApiUrl: gs.customApiUrl     || "",
      pollInterval: gs.pollInterval     || 2,
    }),
  }).catch(() => {});
}

async function _tryAutoSetup() {
  if (_setupAttempted) return;
  const _gs0 = _globalSettings.get();
  if (_gs0.game === "qwilight") { _setupAttempted = true; return; }
  _setupAttempted = true;
  const base = _getBase();
  try {
    const statusRes = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2500) });
    if (!statusRes.ok) return;
    const status = await statusRes.json();
    if (status.patchInstalled) return;

    const gs = _globalSettings.get();
    const setupRes = await fetch(`${base}/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hookUpdateRate: gs.hookUpdateRate || 2 }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await setupRes.json();
    if (result.ok && result.patched && result.patched.length > 0) {
      _updateState({ setupStatus: "done" });
    } else if (!result.ok) {
      _updateState({ setupStatus: "fail" });
    }
  } catch {}
}

function _updateState(updates) {
  if (updates.connected !== undefined) _connected = updates.connected;
  if (updates.data !== undefined) _data = updates.data;
  if (_setState) _setState({ connected: _connected, data: _data, ...updates });
}

async function _poll() {
  if (!_setState) return;
  const base = _getBase();
  try {
    const res = await fetch(`${base}/state`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _updateState({ connected: true, data });
    if (!_setupAttempted) _tryAutoSetup();
  } catch {
    _updateState({ connected: false, data: null });
  }
  if (_setState) {
    const gs = _globalSettings.get();
    const interval = (gs.pollInterval || 2) * 1000;
    _pollTimer = setTimeout(_poll, interval);
  }
}

async function _startPolling() {
  clearTimeout(_pollTimer);
  _pushConfig();
  if (!_autoLaunchAttempted) {
    _autoLaunchAttempted = true;
    _updateState({ _bridgeLaunching: true });
    const ok = await _ensureBridge();
    _updateState({ _bridgeLaunching: false, _launchFailed: !ok });
  }
  _poll();
}

function _stopPolling() {
  clearTimeout(_pollTimer);
  _pollTimer = null;
}

// ── 패널 정의 ────────────────────────────────────────────────────────────────

dmn.plugin.defineElement({
  name: "beatoraja",
  maxInstances: 1,
  resizable: true,
  preserveAxis: "width",
  settingsUI: "panel",

  contextMenu: {
    create: "menu.create",
    delete: "menu.delete",
    items: [
      {
        label: "menu.serverSettings",
        position: "bottom",
        onClick: async () => { _globalSettings.open(); },
      },
      {
        label: "menu.autoSetup",
        position: "bottom",
        onClick: async () => {
          const gs = _globalSettings.get();
          if (gs.game === "qwilight") return;
          const base = _getBase();
          try {
            await fetch(`${base}/setup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hookUpdateRate: gs.hookUpdateRate || 2 }),
              signal: AbortSignal.timeout(10000),
            });
          } catch {}
        },
      },
      {
        label: "menu.startServer",
        position: "bottom",
        onClick: async () => {
          clearTimeout(_pollTimer);
          _updateState({ _bridgeLaunching: true, _launchFailed: false });
          const ok = await _ensureBridge();
          _updateState({ _bridgeLaunching: false, _launchFailed: !ok });
          _startPolling();
        },
      },
      {
        label: "menu.reconnect",
        position: "bottom",
        onClick: async () => {
          clearTimeout(_pollTimer);
          _startPolling();
        },
      },
      {
        label: "menu.disconnect",
        position: "bottom",
        onClick: async () => {
          _stopPolling();
          _updateState({ connected: false, data: null });
        },
      },
      {
        label: "menu.uninstall",
        position: "bottom",
        onClick: async () => {
          const gs = _globalSettings.get();
          if (gs.game === "qwilight") return;
          const base = _getBase();
          try {
            await fetch(`${base}/uninstall`, { method: "POST", signal: AbortSignal.timeout(5000) });
          } catch {}
        },
      },
    ],
  },

  settings: {
    // ── 기본 ──
    playerLabel: {
      type: "string",
      default: "",
      label: "settings.playerLabel",
      placeholder: "settings.playerLabel.placeholder",
    },

    // ── 표시 항목 ──
    _s_display: { type: "divider" },
    showGenre:      { type: "boolean", default: false, label: "settings.showGenre" },
    showKeys:       { type: "boolean", default: true,  label: "settings.showKeys" },
    showBpm:        { type: "boolean", default: true,  label: "settings.showBpm" },
    showNotes:      { type: "boolean", default: false, label: "settings.showNotes" },
    showTable:      { type: "boolean", default: true,  label: "settings.showTable" },
    tableLabel:     { type: "string",  default: "",    label: "settings.tableLabel", placeholder: "settings.tableLabel.placeholder" },
    showDifficulty: { type: "boolean", default: true,  label: "settings.showDifficulty" },
    showScore:      { type: "boolean", default: true,  label: "settings.showScore" },
    showJudge:      { type: "boolean", default: false, label: "settings.showJudge" },
    showPacemaker:  { type: "boolean", default: true,  label: "settings.showPacemaker" },
    showClear:      { type: "boolean", default: true,  label: "settings.showClear" },
    showMiss:       { type: "boolean", default: true,  label: "settings.showMiss" },
    showStatusBar:  { type: "boolean", default: true,  label: "settings.showStatusBar" },

    // ── 레이아웃 ──
    _s_layout: { type: "divider" },
    textAlign: {
      type: "select",
      default: "left",
      label: "settings.textAlign",
      options: [
        { value: "left",   label: "settings.textAlign.left" },
        { value: "center", label: "settings.textAlign.center" },
        { value: "right",  label: "settings.textAlign.right" },
      ],
    },
    fontSize: {
      type: "select",
      default: "medium",
      label: "settings.fontSize",
      options: [
        { value: "small",  label: "settings.fontSize.small" },
        { value: "medium", label: "settings.fontSize.medium" },
        { value: "large",  label: "settings.fontSize.large" },
      ],
    },

    // ── 배경 ──
    _s_bg: { type: "divider" },
    backgroundColor: { type: "color",  default: "#0D0D12", label: "settings.backgroundColor" },
    bgOpacity:       { type: "number", default: 92, min: 0, max: 100, label: "settings.bgOpacity" },

    // ── 플레이어 색상 ──
    _s_colorPlayer: { type: "divider" },
    colorPlayerLabel: { type: "color", default: "#E2E8F0", label: "settings.colorPlayerLabel" },
    colorPlayerName:  { type: "color", default: "#60A5FA", label: "settings.colorPlayerName" },

    // ── 곡 정보 색상 ──
    _s_colorSong: { type: "divider" },
    colorGenre:   { type: "color", default: "#E2E8F0", label: "settings.colorGenre" },
    colorTitle:   { type: "color", default: "#E2E8F0", label: "settings.colorTitle" },
    colorArtist:  { type: "color", default: "#E2E8F0", label: "settings.colorArtist" },

    // ── 차트 정보 색상 ──
    _s_colorChart: { type: "divider" },
    colorKeys:  { type: "color", default: "#E2E8F0", label: "settings.colorKeys" },
    colorLevel: { type: "color", default: "#60A5FA", label: "settings.colorLevel" },
    colorDiff:  { type: "color", default: "#E2E8F0", label: "settings.colorDiff" },
    colorTable: { type: "color", default: "#60A5FA", label: "settings.colorTable" },
    colorBpm:   { type: "color", default: "#E2E8F0", label: "settings.colorBpm" },
    colorNotes: { type: "color", default: "#E2E8F0", label: "settings.colorNotes" },

    // ── 점수 색상 ──
    _s_colorScore: { type: "divider" },
    colorScoreLabel: { type: "color", default: "#E2E8F0", label: "settings.colorScoreLabel" },
    colorRate:       { type: "color", default: "#60A5FA", label: "settings.colorRate" },
    colorExScore:    { type: "color", default: "#E2E8F0", label: "settings.colorExScore" },
    colorCombo:      { type: "color", default: "#E2E8F0", label: "settings.colorCombo" },

    // ── 상태 바 스타일 ──
    _s_colorStatus: { type: "divider" },
    colorStatusBar:    { type: "color",  default: "#E2E8F0", label: "settings.colorStatusBar" },
    statusBarOpacity:  { type: "number", default: 30, min: 0, max: 100, label: "settings.statusBarOpacity" },
    colorStatusDot:    { type: "color",  default: "#4ADE80", label: "settings.colorStatusDot" },
  },

  messages: {
    en: {
      "menu.create":          "Create BMS Now Playing Panel",
      "menu.delete":          "Delete BMS Now Playing Panel",
      "menu.serverSettings":  "Server Settings",
      "menu.autoSetup":       "Auto Setup (Lua Patch)",
      "menu.startServer":     "Start Server",
      "menu.reconnect":       "Reconnect",
      "menu.disconnect":      "Disconnect",
      "menu.uninstall":       "Remove Lua Patch",

      "settings.playerLabel":             "Custom Player Name",
      "settings.playerLabel.placeholder": "Player1",
      "settings.showGenre":       "Show Genre",
      "settings.showKeys":        "Show Key Mode",
      "settings.showBpm":         "Show BPM",
      "settings.showNotes":       "Show Total Notes",
      "settings.showTable":       "Show Table Label",
      "settings.tableLabel":      "Fixed Table Label",
      "settings.tableLabel.placeholder":  "empty = auto",
      "settings.showDifficulty":  "Show Difficulty Name",
      "settings.showScore":       "Show Score",
      "settings.showJudge":       "Show Judge Count",
      "settings.showPacemaker":   "Show Pacemaker",
      "settings.showClear":       "Show Clear Type",
      "settings.showMiss":        "Show Miss Count",
      "settings.showStatusBar":   "Show Connection Status",

      "settings.textAlign":         "Text Align",
      "settings.textAlign.left":    "Left",
      "settings.textAlign.center":  "Center",
      "settings.textAlign.right":   "Right",
      "settings.fontSize":          "Font Size",
      "settings.fontSize.small":    "Small",
      "settings.fontSize.medium":   "Medium",
      "settings.fontSize.large":    "Large",

      "settings.backgroundColor":   "Background Color",
      "settings.bgOpacity":         "Background Opacity (%)",

      "settings.colorPlayerLabel":  "Player Label Color",
      "settings.colorPlayerName":   "Player Name Color",
      "settings.colorGenre":        "Genre Color",
      "settings.colorTitle":        "Title Color",
      "settings.colorArtist":       "Artist Color",
      "settings.colorKeys":         "Key Mode Color",
      "settings.colorLevel":        "Level Color",
      "settings.colorDiff":         "Difficulty Color",
      "settings.colorTable":        "Table Label Color",
      "settings.colorBpm":          "BPM Color",
      "settings.colorNotes":        "Notes Color",
      "settings.colorScoreLabel":   "Score Label Color",
      "settings.colorRate":         "Rate Color",
      "settings.colorExScore":      "EX Score Color",
      "settings.colorCombo":        "Combo Color",
      "settings.colorStatusBar":    "Status Bar Color",
      "settings.statusBarOpacity":  "Status Bar Opacity (%)",
      "settings.colorStatusDot":    "Status Dot Color",

      "status.disconnected":          "Bridge server not running",
      "status.launching":             "Starting bridge server...",
      "status.launchFailed":          "Failed to start server",
      "status.launchFailed.hint":     "Run start.bat in beatoraja-bridge folder",
      "status.setupDone":         "Restart the game for real-time detection",
      "status.setupFail":         "Auto-setup failed — run the game first",
      "label.player":  "PLAYER",
      "label.playing": "PLAYING",
      "label.last":    "LAST PLAYED",
      "label.idle":    "IDLE",
      "ph.title":  "No song selected",
      "ph.artist": "-",
    },
    ko: {
      "menu.create":          "BMS Now Playing 패널 생성",
      "menu.delete":          "BMS Now Playing 패널 삭제",
      "menu.serverSettings":  "서버 설정",
      "menu.autoSetup":       "자동 설정 (Lua 패치)",
      "menu.startServer":     "서버 시작",
      "menu.reconnect":       "재연결",
      "menu.disconnect":      "연결 끊기",
      "menu.uninstall":       "Lua 패치 제거",

      "settings.playerLabel":             "플레이어 이름",
      "settings.playerLabel.placeholder": "Player1",
      "settings.showGenre":       "장르 표시",
      "settings.showKeys":        "키 모드 표시",
      "settings.showBpm":         "BPM 표시",
      "settings.showNotes":       "총 노트 수 표시",
      "settings.showTable":       "난이도표 레이블 표시",
      "settings.tableLabel":      "난이도표 고정",
      "settings.tableLabel.placeholder":  "비워두면 자동",
      "settings.showDifficulty":  "난이도명 표시",
      "settings.showScore":       "점수 표시",
      "settings.showJudge":       "판정 카운트 표시",
      "settings.showPacemaker":   "페이스메이커 표시",
      "settings.showClear":       "클리어 타입 표시",
      "settings.showMiss":        "미스 카운트 표시",
      "settings.showStatusBar":   "연결 상태 표시",

      "settings.textAlign":         "텍스트 정렬",
      "settings.textAlign.left":    "왼쪽",
      "settings.textAlign.center":  "가운데",
      "settings.textAlign.right":   "오른쪽",
      "settings.fontSize":          "글꼴 크기",
      "settings.fontSize.small":    "작게",
      "settings.fontSize.medium":   "보통",
      "settings.fontSize.large":    "크게",

      "settings.backgroundColor":   "배경 색상",
      "settings.bgOpacity":         "배경 불투명도 (%)",

      "settings.colorPlayerLabel":  "플레이어 레이블 색상",
      "settings.colorPlayerName":   "플레이어 이름 색상",
      "settings.colorGenre":        "장르 색상",
      "settings.colorTitle":        "제목 색상",
      "settings.colorArtist":       "아티스트 색상",
      "settings.colorKeys":         "키 모드 색상",
      "settings.colorLevel":        "레벨 색상",
      "settings.colorDiff":         "난이도명 색상",
      "settings.colorTable":        "난이도표 색상",
      "settings.colorBpm":          "BPM 색상",
      "settings.colorNotes":        "노트 수 색상",
      "settings.colorScoreLabel":   "점수 레이블 색상",
      "settings.colorRate":         "RATE 색상",
      "settings.colorExScore":      "EX SCORE 색상",
      "settings.colorCombo":        "COMBO 색상",
      "settings.colorStatusBar":    "상태 바 색상",
      "settings.statusBarOpacity":  "상태 바 불투명도 (%)",
      "settings.colorStatusDot":    "상태 점 색상",

      "status.disconnected":          "브릿지 서버가 실행되지 않음",
      "status.launching":             "브릿지 서버 시작 중...",
      "status.launchFailed":          "서버 시작 실패",
      "status.launchFailed.hint":     "beatoraja-bridge 폴더의 start.bat을 실행하세요",
      "status.setupDone":         "게임을 재시작하면 실시간 감지가 시작됩니다",
      "status.setupFail":         "자동 설정 실패 — 게임을 먼저 실행하세요",
      "label.player":  "플레이어",
      "label.playing": "플레이 중",
      "label.last":    "마지막 플레이",
      "label.idle":    "대기",
      "ph.title":  "선택된 곡 없음",
      "ph.artist": "-",
    },
  },

  previewState: {
    connected: true,
    data: {
      state: "result",
      player: "Player1",
      song: {
        title: "Sample Song Title",
        artist: "Sample Artist feat. Someone",
        genre: "BEMANI",
        bpm: 180,
        notes: 1234,
      },
      chart: { keys: "7KEY", level: 12, diff: "ANOTHER", table: "\u26053" },
      score: { rate: 95.2, exScore: 2345, combo: 512, miss: 3, clear: "HARD", pgreat: 800, great: 200, good: 30, bad: 5, poor: 3, target: 0, targetDiff: 0 },
    },
  },

  template: (state, settings, { html, t }) => {
    const { connected = false, data = null, setupStatus } = state;
    const sz = SIZE_MAP[settings.fontSize] || SIZE_MAP.medium;
    const align = settings.textAlign || "left";

    // 색상
    const cPlayerLabel = settings.colorPlayerLabel || "#E2E8F0";
    const cPlayerName  = settings.colorPlayerName  || "#60A5FA";
    const cTitle       = settings.colorTitle       || "#E2E8F0";
    const cArtist      = settings.colorArtist      || "#E2E8F0";
    const cGenre       = settings.colorGenre       || "#E2E8F0";
    const cKeys        = settings.colorKeys        || "#E2E8F0";
    const cLevel       = settings.colorLevel       || "#60A5FA";
    const cDiff        = settings.colorDiff        || "#E2E8F0";
    const cTable       = settings.colorTable       || "#60A5FA";
    const cBpm         = settings.colorBpm         || "#E2E8F0";
    const cNotes       = settings.colorNotes       || "#E2E8F0";
    const cScoreLabel  = settings.colorScoreLabel  || "#E2E8F0";
    const cRate        = settings.colorRate        || "#60A5FA";
    const cExScore     = settings.colorExScore     || "#E2E8F0";
    const cCombo       = settings.colorCombo       || "#E2E8F0";
    const cStatusBar   = settings.colorStatusBar   || "#E2E8F0";
    const cStatusDot   = settings.colorStatusDot   || "#4ADE80";
    const statusBarOp  = (settings.statusBarOpacity ?? 30) / 100;

    // 배경
    const bgHex     = settings.backgroundColor || "#0D0D12";
    const bgOpacity = (settings.bgOpacity ?? 92) / 100;
    const bgR = parseInt(bgHex.slice(1, 3), 16) || 0;
    const bgG = parseInt(bgHex.slice(3, 5), 16) || 0;
    const bgB = parseInt(bgHex.slice(5, 7), 16) || 0;

    const container = `
      background: rgba(${bgR},${bgG},${bgB},${bgOpacity});
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      padding: 12px 14px;
      width: 100%; height: 100%;
      box-sizing: border-box;
      display: flex; flex-direction: column; gap: 6px;
      font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      user-select: none; cursor: default; overflow: hidden;
      text-align: ${align};
    `;

    const fontLink = html`<link
      href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
      rel="stylesheet"
    />`;

    // ── 연결 안됨 ──
    if (!connected) {
      const launching = state._bridgeLaunching;
      const failed = state._launchFailed;
      const statusText = launching ? t("status.launching") : failed ? t("status.launchFailed") : t("status.disconnected");
      return html`
        ${fontLink}
        <div style=${container}>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:6px;opacity:0.45;">
            <div style="font-size:22px;">🎮</div>
            <div style="font-size:${sz.player}px;font-weight:600;color:${cPlayerLabel};">${statusText}</div>
            <div
              data-plugin-handler="${state._h_startServer || ""}"
              style="font-size:${sz.dim}px;margin-top:2px;padding:3px 12px;border-radius:4px;background:${_rgba(cPlayerName, 0.15)};color:${cPlayerName};cursor:pointer;font-weight:600;border:1px solid ${_rgba(cPlayerName, 0.3)};${launching ? "opacity:0.5;pointer-events:none;" : ""}"
            >${t("menu.startServer")}</div>
            ${failed ? html`<div style="font-size:${sz.dim}px;opacity:0.5;margin-top:2px;color:${cPlayerLabel};">${t("status.launchFailed.hint")}</div>` : ""}
          </div>
        </div>
      `;
    }

    // ── 연결됨 ──
    const playerName = settings.playerLabel || data?.player || "Player1";
    const hasSong    = data && data.song && data.state !== "idle";
    const isPlaying  = hasSong && data.state === "playing";
    const isResult   = hasSong && data.state === "result";

    const statusHex   = isPlaying ? "#4ADE80" : isResult ? cPlayerName : "#9CA3AF";
    const statusLabel = isPlaying
      ? t("label.playing")
      : isResult
        ? t("label.last")
        : t("label.idle");

    const song  = hasSong ? data.song  : null;
    const chart = hasSong ? data.chart : null;
    const score = hasSong ? data.score : null;

    const title   = song?.title  || t("ph.title");
    const artist  = song?.artist || t("ph.artist");
    const genre   = song?.genre  || "";
    const keys    = chart?.keys  || "--";
    const level   = chart?.level ?? "--";
    const diff    = chart?.diff  || "";
    const table   = settings.tableLabel || chart?.table || "";
    const bpm     = song?.bpm    || 0;
    const notes   = song?.notes  || 0;

    const titleOpacity  = hasSong ? 1 : 0.3;
    const artistOpacity = hasSong ? 0.55 : 0.2;

    const statusMsg = !hasSong
      ? setupStatus === "done"
        ? t("status.setupDone")
        : setupStatus === "fail"
          ? t("status.setupFail")
          : ""
      : "";

    const dimStyle = `font-size:${sz.dim}px;opacity:0.4;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;`;

    const gs = _globalSettings.get();
    const _bHost = (gs.bridgeUrl || "http://localhost").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const bridgeHost = `${_bHost}:${gs.bridgePort || 54321}`;

    // flex 정렬 매핑
    const justifyMap = { left: "flex-start", center: "center", right: "flex-end" };
    const justify = justifyMap[align] || "flex-start";

    return html`
      ${fontLink}
      <div style=${container}>

        <!-- 플레이어 행 -->
        <div style="display:flex;align-items:center;justify-content:space-between;min-width:0;">
          <div style="min-width:0;overflow:hidden;">
            <div style="font-size:${sz.dim}px;opacity:0.4;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;color:${cPlayerLabel};">${t("label.player")}</div>
            <div style="font-size:${sz.player}px;font-weight:700;color:${cPlayerName};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              ${playerName}
            </div>
          </div>
          <div style="font-size:${sz.badge}px;padding:2px 7px;border-radius:8px;font-weight:600;background:${_rgba(statusHex, 0.12)};color:${statusHex};border:1px solid ${_rgba(statusHex, 0.25)};white-space:nowrap;flex-shrink:0;">
            ${statusLabel}
          </div>
        </div>

        <!-- 구분선 -->
        <div style="width:100%;height:1px;background:rgba(255,255,255,0.06);"></div>

        <!-- 장르 -->
        ${settings.showGenre === true && genre
          ? html`<div style="font-size:${sz.dim}px;opacity:0.5;text-transform:uppercase;letter-spacing:0.5px;color:${cGenre};">${genre}</div>`
          : ""}

        <!-- 곡 제목 + 아티스트 -->
        <div>
          <div style="font-size:${sz.title}px;font-weight:700;line-height:1.3;opacity:${titleOpacity};color:${cTitle};overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
            ${title}
          </div>
          <div style="font-size:${sz.artist}px;opacity:${artistOpacity};margin-top:3px;color:${cArtist};overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">
            ${artist}
          </div>
        </div>

        <!-- 차트 정보 행 -->
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:${justify};opacity:${hasSong ? 1 : 0.25};min-width:0;">
          ${settings.showKeys !== false
            ? html`<span style="font-size:${sz.info}px;padding:2px 7px;background:${_rgba(cKeys, 0.1)};color:${cKeys};border-radius:4px;font-weight:600;white-space:nowrap;">${keys}</span>`
            : ""}
          ${level !== "--" && level > 0
            ? html`<span style="font-size:${sz.info + 2}px;font-weight:700;color:${cLevel};white-space:nowrap;">\u2606${level}</span>`
            : ""}
          ${settings.showDifficulty !== false && diff
            ? html`<span style="font-size:${sz.info}px;opacity:0.6;color:${cDiff};white-space:nowrap;">${diff}</span>`
            : ""}
          ${settings.showTable !== false && table
            ? html`<span style="font-size:${sz.info}px;padding:2px 7px;background:${_rgba(cTable, 0.08)};color:${cTable};border-radius:4px;font-weight:600;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;">${table}</span>`
            : ""}
          ${settings.showBpm !== false && bpm
            ? html`<span style="font-size:${sz.info}px;opacity:0.5;color:${cBpm};white-space:nowrap;${align === "left" ? "margin-left:auto;" : ""}">${bpm} BPM</span>`
            : ""}
        </div>

        <!-- 노트 수 -->
        ${settings.showNotes === true && notes
          ? html`<div style="font-size:${sz.dim}px;opacity:0.45;color:${cNotes};">${notes.toLocaleString()} NOTES</div>`
          : ""}

        <!-- 점수 -->
        ${settings.showScore !== false && score
          ? html`
            <div style="width:100%;height:1px;background:rgba(255,255,255,0.06);margin-top:2px;"></div>
            <div style="display:flex;gap:12px;align-items:flex-start;min-width:0;flex-wrap:wrap;justify-content:${justify};">
              <div style="min-width:0;">
                <div style="${dimStyle}color:${cScoreLabel};">${gs.game === "qwilight" ? "POINT" : "RATE"}</div>
                <div style="font-size:${sz.info + 2}px;font-weight:700;color:${cRate};white-space:nowrap;">${score.rate != null ? score.rate : "--"}%</div>
              </div>
              <div style="min-width:0;">
                <div style="${dimStyle}color:${cScoreLabel};">EX SCORE</div>
                <div style="font-size:${sz.info + 2}px;font-weight:700;color:${cExScore};white-space:nowrap;">${score.exScore != null ? score.exScore.toLocaleString() : "--"}</div>
              </div>
              <div style="min-width:0;">
                <div style="${dimStyle}color:${cScoreLabel};">COMBO</div>
                <div style="font-size:${sz.info + 2}px;font-weight:700;color:${cCombo};white-space:nowrap;">${score.combo != null ? score.combo.toLocaleString() : score.maxCombo != null ? score.maxCombo.toLocaleString() : "--"}</div>
              </div>
              ${settings.showMiss !== false && score.miss != null
                ? html`<div style="min-width:0;">
                    <div style="${dimStyle}color:${cScoreLabel};">MISS</div>
                    <div style="font-size:${sz.info + 2}px;font-weight:700;color:#EF4444;white-space:nowrap;">${score.miss.toLocaleString()}</div>
                  </div>`
                : ""}
            </div>
          `
          : ""}

        <!-- 판정 카운트 -->
        ${settings.showJudge === true && score && score.pgreat != null
          ? html`
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:${justify};font-size:${sz.dim}px;font-weight:600;">
              <span style="color:#00BFFF;">PG <span style="font-weight:700;">${score.pgreat}</span></span>
              <span style="color:#FFD700;">GR <span style="font-weight:700;">${score.great}</span></span>
              <span style="color:#4ADE80;">GD <span style="font-weight:700;">${score.good}</span></span>
              <span style="color:#A78BFA;">BD <span style="font-weight:700;">${score.bad}</span></span>
              <span style="color:#EF4444;">PR <span style="font-weight:700;">${score.poor}</span></span>
            </div>
          `
          : settings.showJudge === true && score && score.highest != null
            ? html`
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:${justify};font-size:${sz.dim}px;font-weight:600;">
                <span style="color:#FFD700;">Highest <span style="font-weight:700;">${score.highest}</span></span>
                <span style="color:#00BFFF;">Higher <span style="font-weight:700;">${score.higher}</span></span>
                <span style="color:#4ADE80;">High <span style="font-weight:700;">${score.high}</span></span>
                <span style="color:#FCD34D;">Low <span style="font-weight:700;">${score.low}</span></span>
                <span style="color:#A78BFA;">Lower <span style="font-weight:700;">${score.lower}</span></span>
                <span style="color:#EF4444;">Lowest <span style="font-weight:700;">${score.lowest}</span></span>
              </div>
            `
            : ""}

        <!-- 페이스메이커 -->
        ${settings.showPacemaker !== false && isPlaying && score && score.target > 0
          ? html`
            <div style="display:flex;align-items:center;gap:6px;justify-content:${justify};font-size:${sz.info}px;">
              <span style="opacity:0.5;color:${cScoreLabel};font-size:${sz.dim}px;font-weight:600;">TARGET</span>
              <span style="font-weight:700;color:${(score.targetDiff || 0) >= 0 ? "#4ADE80" : "#EF4444"};">${(score.targetDiff || 0) >= 0 ? "+" : ""}${score.targetDiff || 0}</span>
            </div>
          `
          : ""}

        <!-- 클리어 타입 -->
        ${settings.showClear !== false && isResult && score && score.clear
          ? html`
            <div style="display:flex;justify-content:${justify};">
              <span style="font-size:${sz.badge}px;padding:2px 8px;border-radius:6px;font-weight:700;white-space:nowrap;
                background:${_rgba(_clearStyle(score.clear, cPlayerName), 0.15)};
                color:${_clearStyle(score.clear, cPlayerName)};
                border:1px solid ${_rgba(_clearStyle(score.clear, cPlayerName), 0.3)};">
                ${score.clear}
              </span>
            </div>
          `
          : ""}

        <!-- 셋업 상태 -->
        ${statusMsg
          ? html`<div style="font-size:${sz.dim}px;opacity:0.35;text-align:center;padding:4px 0;color:${cPlayerLabel};">${statusMsg}</div>`
          : ""}

        <!-- 하단 연결 상태 -->
        ${settings.showStatusBar !== false
          ? html`
            <div style="font-size:${sz.dim}px;opacity:${statusBarOp};color:${cStatusBar};margin-top:auto;display:flex;align-items:center;gap:3px;min-width:0;overflow:hidden;justify-content:${justify};">
              <span style="width:5px;height:5px;border-radius:50%;background:${cStatusDot};display:inline-block;flex-shrink:0;"></span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${bridgeHost}</span>
            </div>
          `
          : ""}

      </div>
    `;
  },

  onMount: ({ setState, onSettingsChange }) => {
    _setState = setState;
    setState({ connected: _connected, data: _data });
    _startPolling();

    const unsubGlobal = _globalSettings.subscribe(() => {
      clearTimeout(_pollTimer);
      _startPolling();
    });

    onSettingsChange(() => {});

    const startServerId = "__beatoraja_start_server";
    window[startServerId] = async () => {
      clearTimeout(_pollTimer);
      _updateState({ _bridgeLaunching: true, _launchFailed: false });
      const ok = await _ensureBridge();
      _updateState({ _bridgeLaunching: false, _launchFailed: !ok });
      _startPolling();
    };
    setState({ _h_startServer: startServerId });

    return () => {
      _stopPolling();
      _setState = null;
      _autoLaunchAttempted = false;
      unsubGlobal();
      delete window[startServerId];
    };
  },
});

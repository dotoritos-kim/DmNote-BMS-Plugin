/**
 * dmnote-bridge (beatoraja / lr2oraja / Qwilight)
 *
 * 게임 상태를 HTTP로 DmNote 플러그인에 제공합니다.
 *
 * GET  /state   — 현재 상태 반환
 * GET  /status  — 서버 설정 현황 및 watcher 상태 반환
 * POST /config  — DmNote 설정 패널에서 동적 재구성
 *
 * 실행:
 *   node index.js
 *   node index.js --dir "D:/beatoraja"
 *   node index.js --game qwilight
 *   node index.js --port 54321
 */

"use strict";

const http     = require("http");
const path     = require("path");
const fs       = require("fs");
const chokidar = require("chokidar");
const { execSync } = require("child_process");

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };

const PORT       = parseInt(getArg("--port") || process.env.PORT || "54321", 10);
const FORCE_DIR  = getArg("--dir") || process.env.BEATORAJA_DIR || process.env.LR2ORAJA_DIR || null;
const FORCE_GAME = getArg("--game") || null; // "beatoraja" | "qwilight"

// ─── Steam 라이브러리 자동 탐지 ──────────────────────────────────────────────

function discoverSteamLibraries() {
  const steamRoots = [
    "C:/Program Files (x86)/Steam",
    "C:/Program Files/Steam",
    "D:/Program Files (x86)/Steam",
    "D:/Program Files/Steam",
    "D:/Steam",
    "E:/Steam",
  ];
  const libs = new Set();
  for (const root of steamRoots) {
    const vdfPath = path.join(root, "steamapps", "libraryfolders.vdf");
    if (!fs.existsSync(vdfPath)) continue;
    try {
      const content = fs.readFileSync(vdfPath, "utf8");
      // VDF 형식: "path"		"C:\\SteamLibrary"  또는 "path"  "D:/SteamLibrary"
      const re = /"path"\s+"([^"]+)"/g;
      let m;
      while ((m = re.exec(content)) !== null) {
        libs.add(m[1].replace(/\\\\/g, "/"));
      }
      // Steam 루트 자체도 라이브러리
      libs.add(root);
    } catch {}
  }
  return [...libs];
}

const _steamLibs = discoverSteamLibraries();

function steamCandidates(...gameFolders) {
  const out = [];
  for (const lib of _steamLibs) {
    for (const folder of gameFolders) {
      out.push(path.join(lib, "steamapps", "common", folder));
    }
  }
  return out;
}

// ─── 게임 경로 자동 탐지 ──────────────────────────────────────────────────────

const HOME = process.env.USERPROFILE || process.env.HOME || "";
const DEFAULT_CANDIDATES = [
  FORCE_DIR,
  // beatoraja 일반적 경로
  "C:/beatoraja",
  "D:/beatoraja",
  "E:/beatoraja",
  "C:/Games/beatoraja",
  "D:/Games/beatoraja",
  "C:/Users/Public/beatoraja",
  HOME && path.join(HOME, "beatoraja"),
  HOME && path.join(HOME, "Desktop", "beatoraja"),
  HOME && path.join(HOME, "Downloads", "beatoraja"),
  HOME && path.join(HOME, "Documents", "beatoraja"),
  // lr2oraja 일반적 경로
  "C:/lr2oraja",
  "D:/lr2oraja",
  "E:/lr2oraja",
  "C:/Games/lr2oraja",
  "D:/Games/lr2oraja",
  "C:/Users/Public/lr2oraja",
  HOME && path.join(HOME, "lr2oraja"),
  HOME && path.join(HOME, "Desktop", "lr2oraja"),
  HOME && path.join(HOME, "Downloads", "lr2oraja"),
  HOME && path.join(HOME, "Documents", "lr2oraja"),
  // Steam 라이브러리 자동 탐지
  ...steamCandidates("beatoraja", "lr2oraja"),
  // 현재 디렉토리 기준
  path.join(process.cwd(), ".."),
  process.cwd(),
].filter(Boolean);

function findDir(candidates = DEFAULT_CANDIDATES) {
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, "songdata.db"))) return d;
  }
  return null;
}

// ─── 게임 프로세스에서 경로 자동 감지 (beatoraja / lr2oraja) ─────────────────

function _execProcess(cmd, timeout = 6000) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout, windowsHide: true }).trim();
  } catch { return ""; }
}

function detectGameProcess() {
  const patterns = ["beatoraja", "lr2oraja"];

  for (const pattern of patterns) {
    // 1차: Get-CimInstance (Windows 10+, wmic 대체)
    const cim = _execProcess(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*${pattern}*' } | Select-Object -First 1 -ExpandProperty ExecutablePath"`,
      8000
    );
    if (cim) {
      const result = _resolveGameDir(cim);
      if (result) return result;
    }

    // 2차: Get-Process (CommandLine 없이 프로세스명으로 탐색)
    const gp = _execProcess(
      `powershell -NoProfile -Command "Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*${pattern}*' } | Select-Object -First 1 -ExpandProperty Path"`,
      8000
    );
    if (gp) {
      const result = _resolveGameDir(gp);
      if (result) return result;
    }

    // 3차: wmic (구형 Windows 호환 — Windows 11에서 제거됨)
    const wmic = _execProcess(
      `wmic process where "commandline like '%${pattern}%'" get executablepath /format:list`,
      5000
    );
    const wmicMatch = wmic.match(/ExecutablePath=(.+)/);
    if (wmicMatch) {
      const result = _resolveGameDir(wmicMatch[1].trim());
      if (result) return result;
    }
  }
  return null;
}

function _resolveGameDir(exePath) {
  // javaw.exe 경로: <installDir>\jre\bin\javaw.exe → 2단계 상위
  let candidate = path.dirname(path.dirname(path.dirname(exePath)));

  // 검증: songdata.db 또는 beatoraja.jar/lr2oraja.jar 존재 확인
  if (fs.existsSync(path.join(candidate, "songdata.db")) ||
      fs.existsSync(path.join(candidate, "beatoraja.jar")) ||
      fs.existsSync(path.join(candidate, "lr2oraja.jar"))) {
    return candidate;
  }

  // jre 없이 직접 실행된 경우: <installDir>\bin\javaw.exe → 1단계 상위에서 재시도
  candidate = path.dirname(path.dirname(exePath));
  if (fs.existsSync(path.join(candidate, "songdata.db"))) {
    return candidate;
  }

  // exe가 직접 게임 디렉토리에 있는 경우
  candidate = path.dirname(exePath);
  if (fs.existsSync(path.join(candidate, "songdata.db"))) {
    return candidate;
  }

  return null;
}

// ─── Lua 스킨 자동 패치 ─────────────────────────────────────────────────────

const HOOK_FILE = "dmnote_hook.lua";
const BACKUP_SUFFIX = ".dmnote_backup";
const PATCH_MARKER = "-- DMNOTE_HOOK_INJECTED";

function getActiveSkinPaths(gameDir) {
  const paths = [];
  const playerRoot = path.join(gameDir, "player");
  if (!fs.existsSync(playerRoot)) return paths;

  for (const folder of fs.readdirSync(playerRoot)) {
    const cfgPath = path.join(playerRoot, folder, "config_player.json");
    if (!fs.existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      if (!Array.isArray(cfg.skin)) continue;
      for (const s of cfg.skin) {
        if (s.path && s.path.endsWith(".luaskin")) {
          const fullPath = path.join(gameDir, s.path.replace(/\\/g, "/"));
          if (fs.existsSync(fullPath)) paths.push(fullPath);
        }
      }
      // skinHistory 에서도 추가 (사용된 적 있는 스킨)
      if (Array.isArray(cfg.skinHistory)) {
        for (const s of cfg.skinHistory) {
          if (s.path && s.path.endsWith(".luaskin")) {
            const fullPath = path.join(gameDir, s.path.replace(/\\/g, "/"));
            if (fs.existsSync(fullPath) && !paths.includes(fullPath)) {
              paths.push(fullPath);
            }
          }
        }
      }
    } catch {}
  }
  return paths;
}

function _buildInjection(indent, expr, hookAbsPath) {
  const luaPath = hookAbsPath.replace(/\\/g, "/");
  return `${indent}${PATCH_MARKER}\n` +
    `${indent}local _dmnote_skin = ${expr}\n` +
    `${indent}pcall(function()\n` +
    `${indent}  local _f = loadfile("${luaPath}")\n` +
    `${indent}  if _f then _f() end\n` +
    `${indent}  if DMNOTE_inject then DMNOTE_inject(_dmnote_skin) end\n` +
    `${indent}end)\n` +
    `${indent}return _dmnote_skin`;
}

function patchLuaskin(content, hookAbsPath) {
  // 이미 패치되어 있으면 스킵
  if (content.includes(PATCH_MARKER)) return null;

  // 전략 1: "if skin_config then\n  return EXPR" (개행 후 return)
  const pat1 = /(if\s+skin_config\s+then\s*\n)([\t ]*)(return\s+)(.+)/;
  const m1 = content.match(pat1);
  if (m1) {
    const [, ifLine, indent, , expr] = m1;
    return content.replace(pat1, ifLine + _buildInjection(indent, expr, hookAbsPath));
  }

  // 전략 2: "if skin_config then return EXPR" (한 줄)
  const pat2 = /([\t ]*)(if\s+skin_config\s+then)\s+(return\s+)(.+)/;
  const m2 = content.match(pat2);
  if (m2) {
    const [, indent, ifPart, , expr] = m2;
    const replacement = `${indent}${ifPart}\n` + _buildInjection(indent + "  ", expr, hookAbsPath);
    return content.replace(pat2, replacement);
  }

  // 전략 3: 최상위 "return skin" (skin_config 분기 없는 스킨)
  const pat3 = /^([\t ]*)(return\s+)(skin\b.*)$/m;
  const m3 = content.match(pat3);
  if (m3) {
    const [, indent, , expr] = m3;
    return content.replace(pat3, _buildInjection(indent, expr, hookAbsPath));
  }

  return null;
}

function setupLuaHook(gameDir, hookInterval) {
  const results = { patched: [], skipped: [], errors: [] };

  // 1. dmnote_hook.lua 를 게임 루트에 복사 (interval 값 치환)
  const hookSrc = path.join(__dirname, HOOK_FILE);
  const hookDst = path.join(gameDir, HOOK_FILE);
  if (!fs.existsSync(hookSrc)) {
    results.errors.push(`${HOOK_FILE} not found in bridge directory`);
    return results;
  }
  try {
    let hookContent = fs.readFileSync(hookSrc, "utf8");
    if (hookInterval === 0) {
      // 0 = 매 프레임 (쓰로틀 없음)
      hookContent = hookContent.replace(
        /DMNOTE_INTERVAL\s*=\s*[\d.]+/,
        `DMNOTE_INTERVAL = 0`
      );
    } else if (hookInterval && hookInterval > 0) {
      const interval = 1 / hookInterval;  // Hz → 초
      hookContent = hookContent.replace(
        /DMNOTE_INTERVAL\s*=\s*[\d.]+/,
        `DMNOTE_INTERVAL = ${interval}`
      );
    }
    // 출력 파일 절대 경로로 치환 (CWD 무관하게 동작)
    const absOutput = path.join(gameDir, "dmnote_state.json").replace(/\\/g, "/");
    hookContent = hookContent.replace(
      /DMNOTE_OUTPUT\s*=\s*"[^"]*"/,
      `DMNOTE_OUTPUT    = "${absOutput}"`
    );
    fs.writeFileSync(hookDst, hookContent, "utf8");
    const label = hookInterval === 0 ? "every frame" : `${hookInterval > 0 ? (1/hookInterval).toFixed(2) : 0.5}s`;
    console.log(`[setup] ${HOOK_FILE} → ${hookDst} (interval: ${label})`);
  } catch (e) {
    results.errors.push(`Failed to copy ${HOOK_FILE}: ${e.message}`);
    return results;
  }

  // 2. 활성 스킨 .luaskin 파일 패치
  const skinPaths = getActiveSkinPaths(gameDir);
  for (const skinPath of skinPaths) {
    try {
      const content = fs.readFileSync(skinPath, "utf8");

      // 이미 패치됨
      if (content.includes(PATCH_MARKER)) {
        results.skipped.push(skinPath);
        continue;
      }

      const patched = patchLuaskin(content, hookDst);
      if (!patched) {
        results.skipped.push(skinPath);
        continue;
      }

      // 백업
      const backupPath = skinPath + BACKUP_SUFFIX;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(skinPath, backupPath);
      }

      fs.writeFileSync(skinPath, patched, "utf8");
      results.patched.push(skinPath);
      console.log(`[setup] 패치 완료: ${skinPath}`);
    } catch (e) {
      results.errors.push(`${skinPath}: ${e.message}`);
    }
  }

  return results;
}

function uninstallLuaHook(gameDir) {
  const results = { restored: [], errors: [] };

  // 1. .luaskin 백업 복원
  const skinPaths = getActiveSkinPaths(gameDir);
  for (const skinPath of skinPaths) {
    const backupPath = skinPath + BACKUP_SUFFIX;
    if (fs.existsSync(backupPath)) {
      try {
        fs.copyFileSync(backupPath, skinPath);
        fs.unlinkSync(backupPath);
        results.restored.push(skinPath);
        console.log(`[uninstall] 복원: ${skinPath}`);
      } catch (e) {
        results.errors.push(`${skinPath}: ${e.message}`);
      }
    }
  }

  // 2. dmnote_hook.lua 삭제
  const hookPath = path.join(gameDir, HOOK_FILE);
  if (fs.existsSync(hookPath)) {
    try {
      fs.unlinkSync(hookPath);
      console.log(`[uninstall] 삭제: ${hookPath}`);
    } catch (e) {
      results.errors.push(`${hookPath}: ${e.message}`);
    }
  }

  // 3. dmnote_state.json 삭제
  const statePath = path.join(gameDir, "dmnote_state.json");
  if (fs.existsSync(statePath)) {
    try { fs.unlinkSync(statePath); } catch {}
  }

  return results;
}

function isPatchInstalled(gameDir) {
  if (!gameDir) return false;
  return fs.existsSync(path.join(gameDir, HOOK_FILE));
}

// ─── SQLite ───────────────────────────────────────────────────────────────────

let DB = null;
try {
  DB = require("better-sqlite3");
} catch {
  console.error("[bridge] better-sqlite3 없음 → npm install 실행 후 재시작하세요.");
  process.exit(1);
}

// ─── 런타임 설정 (POST /config 로 변경 가능) ──────────────────────────────────

let config = {
  game:         "beatoraja", // "beatoraja" | "qwilight"
  method:       "sqlite",   // "sqlite" | "lua+sqlite" | "custom-api" (qwilight: sqlite only)
  dir:          null,        // null = 자동탐지
  luaStatePath: "",          // lua+sqlite 사용 시
  customApiUrl: "",          // custom-api 사용 시
  pollInterval: 3,           // 초 (참고용, 서버 내부 폴링은 1초 고정)
};

function isQwilight() { return config.game === "qwilight"; }

// ─── 상태 ────────────────────────────────────────────────────────────────────

let dir          = null;   // 현재 게임 경로
let luaData      = null;   // Lua 스킨이 쓴 최신 데이터
let luaWrittenAt = 0;      // Lua 파일 마지막 수신 시각
let scoreData    = null;   // scorelog.db 에서 읽은 최신 결과
let scoreMtime   = 0;      // scorelog.db 마지막 mtime
let lastUpdate   = 0;      // 마지막 상태 변경 시각

// Lua 데이터가 유효한 것으로 간주하는 TTL (초)
// hook이 5초마다 하트비트를 보냄 → 15초 미수신이면 게임 종료로 판단
const PLAYING_TTL = 15;

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

// beatoraja/lr2oraja Mode enum 순서: BEAT_7KEY=0, BEAT_5KEY=1, BEAT_14KEY=2, BEAT_10KEY=3,
// POPN_9KEY=4, KEYBOARD_24KEY=5, KEYBOARD_48KEY=6
const KEY_MODE = {
  0:"7KEY",1:"5KEY",2:"14KEY",3:"10KEY",4:"9KEY",
  5:"24KEY",6:"48KEY",
};
const DIFF = ["EASY","NORMAL","HYPER","ANOTHER","INSANE"];
const CLEAR_TYPE = [
  "", "FAILED", "ASSIST", "L-ASSIST", "EASY",
  "NORMAL", "HARD", "EX-HARD", "FC", "PERFECT", "MAX",
];
const keyLabel   = (n) => KEY_MODE[n] || `${n}KEY`;
const diffLabel  = (n) => DIFF[n] ?? "";
const clearLabel = (n) => CLEAR_TYPE[n] ?? "";

// 숫자값 유효성 검증 (Java Integer.MIN_VALUE 등 오버플로우 방지)
const clampNum = (v, lo, hi) => (v == null || v < lo || v > hi) ? 0 : v;

// ─── Qwilight 유틸리티 ──────────────────────────────────────────────────────

// Qwilight InputMode enum (Component.cs)
const QW_INPUT_MODE = {
  4: "4KEY", 5: "5KEY", 6: "6KEY", 7: "7KEY", 8: "8KEY", 9: "9KEY",
  10: "5KEY+SC", 11: "7KEY+SC", 12: "10KEY+2SC", 13: "14KEY+2SC",
  14: "10KEY", 15: "24KEY+2SC", 16: "48KEY+4SC",
};
const qwKeyLabel = (n) => QW_INPUT_MODE[n] || `${n}KEY`;

// Qwilight QuitStatus(Stand) enum (DefaultCompute.cs)
const QW_STAND = { 0: "S+", 1: "S", 2: "A+", 3: "A", 4: "B", 5: "C", 6: "D", 7: "F" };
const qwStandLabel = (n) => QW_STAND[n] ?? `${n}`;

// ─── Qwilight 경로 탐지 ─────────────────────────────────────────────────────

const QW_CANDIDATES = [
  "C:/Program Files (x86)/Steam/steamapps/common/Qwilight",
  "D:/Program Files (x86)/Steam/steamapps/common/Qwilight",
  "C:/Program Files/Steam/steamapps/common/Qwilight",
  "D:/SteamLibrary/steamapps/common/Qwilight",
  "E:/SteamLibrary/steamapps/common/Qwilight",
  ...steamCandidates("Qwilight"),
];

function findQwilightDir() {
  for (const d of QW_CANDIDATES) {
    if (fs.existsSync(path.join(d, "SavesDir", "DB.db"))) return d;
  }
  return null;
}

function _resolveQwilightDir(exePath) {
  const candidate = path.dirname(exePath);
  if (fs.existsSync(path.join(candidate, "SavesDir", "DB.db"))) return candidate;
  return null;
}

function detectQwilightProcess() {
  // 1차: Get-CimInstance
  const cim = _execProcess(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -like \'Qwilight*\' } | Select-Object -First 1 -ExpandProperty ExecutablePath"',
    8000
  );
  if (cim) {
    const result = _resolveQwilightDir(cim);
    if (result) return result;
  }

  // 2차: Get-Process
  const gp = _execProcess(
    'powershell -NoProfile -Command "Get-Process -Name Qwilight* -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path"',
    8000
  );
  if (gp) {
    const result = _resolveQwilightDir(gp);
    if (result) return result;
  }

  // 3차: wmic (구형 Windows 호환)
  const wmic = _execProcess(
    'wmic process where "name like \'Qwilight%\'" get executablepath /format:list',
    5000
  );
  const wmicMatch = wmic.match(/ExecutablePath=(.+)/);
  if (wmicMatch) {
    const result = _resolveQwilightDir(wmicMatch[1].trim());
    if (result) return result;
  }

  return null;
}

// ─── Qwilight DB.json 캐시 ──────────────────────────────────────────────────

let qwNoteFiles      = null;  // { noteID512: noteFile } 맵
let qwNoteFilesMtime = 0;

function loadQwNoteFiles(qwDir) {
  const jsonPath = path.join(qwDir, "SavesDir", "DB.json");
  if (!fs.existsSync(jsonPath)) return;
  try {
    const mtime = fs.statSync(jsonPath).mtimeMs;
    if (mtime === qwNoteFilesMtime && qwNoteFiles) return;
    qwNoteFilesMtime = mtime;
    let raw = fs.readFileSync(jsonPath, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // BOM 제거
    const data = JSON.parse(raw);
    qwNoteFiles = data.noteFiles || {};
    console.log(`[qwilight] DB.json 로드: ${Object.keys(qwNoteFiles).length}곡`);
  } catch (e) {
    console.error("[qwilight] DB.json 읽기 오류:", e.message);
  }
}

// ─── Qwilight 플레이어 이름 ─────────────────────────────────────────────────

function readQwilightPlayerName(qwDir) {
  const cfgPath = path.join(qwDir, "SavesDir", "Configure.json");
  try {
    let raw = fs.readFileSync(cfgPath, "utf8");
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const cfg = JSON.parse(raw);
    if (cfg.AvatarID) return cfg.AvatarID;
  } catch {}
  return "Player";
}

// ─── Qwilight 스코어 읽기 ───────────────────────────────────────────────────

function readQwilightScore(qwDir) {
  const dbPath = path.join(qwDir, "SavesDir", "DB.db");
  if (!fs.existsSync(dbPath)) return null;
  let db;
  try {
    db = DB(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`
      SELECT Date, Note_ID, Avatar_Name, InputMode, Stand, Point,
             Highest_Judgment, Higher_Judgment, High_Judgment,
             Low_Judgment, Lower_Judgment, Lowest_Judgment
      FROM comment ORDER BY Date DESC LIMIT 1
    `).get();
    if (!row) return null;

    // DB.json에서 곡 메타데이터 조회
    loadQwNoteFiles(qwDir);
    const note = qwNoteFiles?.[row.Note_ID] || null;

    const stand    = qwStandLabel(row.Stand);
    const highest  = row.Highest_Judgment || 0;
    const higher   = row.Higher_Judgment  || 0;
    const high     = row.High_Judgment    || 0;
    const low      = row.Low_Judgment     || 0;
    const lower    = row.Lower_Judgment   || 0;
    const lowest   = row.Lowest_Judgment  || 0;
    const miss     = lower + lowest;

    // Point: 0~1이면 ×100, 이미 0~100이면 그대로
    let point = row.Point || 0;
    if (point > 0 && point <= 1) point = Math.round(point * 10000) / 100;

    const keys  = qwKeyLabel(row.InputMode);
    const level = clampNum(note?.levelTextValue, 0, 999);

    return {
      state: "result",
      game:  "qwilight",
      player: row.Avatar_Name || readQwilightPlayerName(qwDir),
      song: note ? {
        title:  note.title  || "",
        artist: note.artist || "",
        genre:  note.genre  || "",
        level,
        bpm:    clampNum(note.levyingBPM || note.bpm, 0, 99999),
        notes:  clampNum(note.totalNotes, 0, 999999),
      } : null,
      chart: {
        keys,
        level,
        diff:  note?.levelText || "",
        label: `${keys} ${note?.levelText || ""}`.trim(),
      },
      score: {
        point, stand,
        highest, higher, high, low, lower, lowest,
        // 호환 필드 (beatoraja 플러그인 템플릿용)
        exScore: null,
        rate:    point,
        combo:   null,
        miss,
        clear:   row.Stand === 7 ? "FAILED" : stand,
        pgreat:  null, great: null, good: null, bad: null, poor: null,
        target:  0, targetDiff: 0,
      },
    };
  } catch (e) {
    console.error("[qwilight] 스코어 읽기 오류:", e.message);
    return null;
  } finally {
    try { db?.close(); } catch {}
  }
}

// ─── Qwilight DB.db 폴링 ────────────────────────────────────────────────────

let qwDbMtime      = 0;
let qwScoreData    = null;
let qwPollingTimer = null;

function startQwilightPolling(qwDir) {
  stopQwilightPolling();
  const dbPath = path.join(qwDir, "SavesDir", "DB.db");
  if (!fs.existsSync(dbPath)) {
    console.warn("[qwilight] DB.db 없음");
    return;
  }
  console.log(`[qwilight] 감시 중: ${dbPath}`);

  // 초기 DB.json 로드
  loadQwNoteFiles(qwDir);

  const tick = () => {
    try {
      const mtime = fs.statSync(dbPath).mtimeMs;
      if (mtime === qwDbMtime) return;
      const isFirst = qwDbMtime === 0;
      qwDbMtime = mtime;
      if (isFirst) {
        qwScoreData = readQwilightScore(qwDir);
        return;
      }
      setTimeout(() => {
        const result = readQwilightScore(qwDir);
        if (result) {
          qwScoreData = result;
          lastUpdate  = Date.now();
          console.log(`[qwilight] 결과: ${result.song?.title ?? "?"} [${result.chart?.label ?? "?"}]`);
        }
      }, 700);
    } catch {}
  };

  qwPollingTimer = setInterval(tick, 1000);
}

function stopQwilightPolling() {
  if (qwPollingTimer) {
    clearInterval(qwPollingTimer);
    qwPollingTimer = null;
    console.log("[qwilight] 폴링 중지");
  }
  qwDbMtime   = 0;
  qwScoreData = null;
}

// ─── Watcher 핸들 (재구성 시 정리용) ─────────────────────────────────────────

let luaWatcher      = null;
let scorelogTimer   = null;
let scorelogPath    = null;
let dirRetryTimer   = null;

// ─── Lua 상태 파일 감시 ───────────────────────────────────────────────────────

// 구 버전 훅 자동 교체 플래그 (세션당 1회)
let _legacyHookReplaced = false;

function _detectAndReplaceLegacyHook(d) {
  if (_legacyHookReplaced || !dir) return;
  // 구 훅 감지: score 존재하지만 pgreat 필드 없음, 또는 exScore > notes*2
  const score = d?.score;
  const notes = d?.song?.notes || 0;
  if (!score) return;
  const maxEx = notes * 2;
  const isLegacy = (score.pgreat == null && score.exScore != null)
    || (maxEx > 0 && score.exScore > maxEx);
  if (!isLegacy) return;

  _legacyHookReplaced = true;
  const hookSrc = path.join(__dirname, HOOK_FILE);
  const hookDst = path.join(dir, HOOK_FILE);
  if (!fs.existsSync(hookSrc)) return;
  try {
    let hookContent = fs.readFileSync(hookSrc, "utf8");
    const absOutput = path.join(dir, "dmnote_state.json").replace(/\\/g, "/");
    hookContent = hookContent.replace(
      /DMNOTE_OUTPUT\s*=\s*"[^"]*"/,
      `DMNOTE_OUTPUT    = "${absOutput}"`
    );
    fs.writeFileSync(hookDst, hookContent, "utf8");
    console.log(`[lua]   구 버전 훅 감지 → 자동 교체: ${hookDst}`);
    console.log(`[lua]   게임 재시작 시 신 훅이 로드됩니다.`);
  } catch (e) {
    console.error(`[lua]   훅 자동 교체 실패: ${e.message}`);
  }
}

function startLuaWatcher(filePath) {
  stopLuaWatcher();
  if (!filePath) return;

  luaWatcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 30, pollInterval: 30 },
  });

  const onFile = () => {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const d   = JSON.parse(raw);
      luaData      = d;
      luaWrittenAt = Date.now();
      lastUpdate   = Date.now();
      _detectAndReplaceLegacyHook(d);
    } catch { /* 쓰기 도중 읽음 */ }
  };

  luaWatcher.on("add",    onFile);
  luaWatcher.on("change", onFile);
  luaWatcher.on("unlink", () => {
    luaData      = null;
    luaWrittenAt = 0;
  });

  console.log(`[lua]   감시 중: ${filePath}`);
}

function stopLuaWatcher() {
  if (luaWatcher) {
    luaWatcher.close();
    luaWatcher = null;
    console.log("[lua]   감시 중지");
  }
}

// ─── scorelog.db 폴링 ─────────────────────────────────────────────────────────

function findScorelog(gameDir) {
  if (!gameDir) return null;
  const playerRoot = path.join(gameDir, "player");
  if (!fs.existsSync(playerRoot)) return null;
  for (const f of fs.readdirSync(playerRoot)) {
    const p = path.join(playerRoot, f, "scorelog.db");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function startScorelogPolling(gameDir) {
  stopScorelogPolling();

  scorelogPath = findScorelog(gameDir);
  if (scorelogPath) console.log(`[score] 감시 중: ${scorelogPath}`);
  else              console.warn(`[score] scorelog.db 없음 (게임을 한 번 실행 후 재시작하세요)`);

  const tick = () => {
    if (!scorelogPath) {
      scorelogPath = findScorelog(dir);
      if (scorelogPath) console.log(`[score] 발견: ${scorelogPath}`);
      return;
    }
    try {
      const mtime = fs.statSync(scorelogPath).mtimeMs;
      if (mtime === scoreMtime) return;
      const isFirst = scoreMtime === 0;
      scoreMtime = mtime;
      if (isFirst) {
        scoreData = readScore(scorelogPath, dir);
        return;
      }
      // 갱신 = 플레이 완료
      setTimeout(() => {
        const result = readScore(scorelogPath, dir);
        if (result) {
          scoreData  = result;
          lastUpdate = Date.now();
          console.log(`[score] 결과: ${result.song?.title ?? "?"} [${result.chart?.label ?? "?"}]`);
        }
      }, 700);
    } catch {}
  };

  scorelogTimer = setInterval(tick, 1000);
}

function stopScorelogPolling() {
  if (scorelogTimer) {
    clearInterval(scorelogTimer);
    scorelogTimer = null;
    console.log("[score] 폴링 중지");
  }
  scoreMtime   = 0;
  scorelogPath = null;
}

function readScore(slogPath, gameDir) {
  if (!gameDir) return null;
  const songdbPath = path.join(gameDir, "songdata.db");
  if (!fs.existsSync(songdbPath)) return null;
  let sdb, gdb;
  try {
    sdb = DB(slogPath,   { readonly: true, fileMustExist: true });
    gdb = DB(songdbPath, { readonly: true, fileMustExist: true });

    // 스키마 동적 감지: 신규 beatoraja/lr2oraja는 개별 판정 컬럼 사용
    const columns = sdb.prepare("PRAGMA table_info(scorelog)").all().map(c => c.name);
    const hasJudgeCols = columns.includes("epg");

    let sha256, mode, clear, ex, combo, miss, pgreat, great, good, bad, poor;

    if (hasJudgeCols) {
      // 신규 스키마: epg,lpg,egr,lgr,egd,lgd,ebd,lbd,epr,lpr,ems,lms
      const row = sdb.prepare(`
        SELECT sha256, mode, clear,
          epg, lpg, egr, lgr, egd, lgd, ebd, lbd, epr, lpr, ems, lms
        FROM scorelog ORDER BY date DESC LIMIT 1
      `).get();
      if (!row) return null;
      sha256 = row.sha256; mode = row.mode; clear = row.clear;
      pgreat = (row.epg || 0) + (row.lpg || 0);
      great  = (row.egr || 0) + (row.lgr || 0);
      good   = (row.egd || 0) + (row.lgd || 0);
      bad    = (row.ebd || 0) + (row.lbd || 0);
      poor   = (row.epr || 0) + (row.lpr || 0) + (row.ems || 0) + (row.lms || 0);
      ex     = pgreat * 2 + great;
      miss   = bad + poor;
      combo  = 0; // 신규 스키마에 combo 컬럼 없음
    } else {
      // 구형 스키마: score, combo, minbp
      const row = sdb.prepare(`
        SELECT sha256, mode, clear, score, combo, minbp
        FROM scorelog ORDER BY date DESC LIMIT 1
      `).get();
      if (!row) return null;
      sha256 = row.sha256; mode = row.mode; clear = row.clear;
      ex    = row.score ?? 0;
      combo = row.combo ?? 0;
      miss  = row.minbp ?? 0;
    }

    const song = gdb.prepare(
      `SELECT title, artist, subartist, genre, level, difficulty, notes, minbpm, maxbpm FROM song WHERE sha256 = ?`
    ).get(sha256);

    // 아티스트 + 서브아티스트 합치기
    let fullArtist = song?.artist || "";
    if (song?.subartist) fullArtist += " " + song.subartist;

    const sLevel = clampNum(song?.level, 0, 999);
    const sBpm   = clampNum(song?.maxbpm, 0, 99999);
    const sNotes = clampNum(song?.notes, 0, 999999);

    // rate = EX / (총노트 × 2) × 100
    const maxEx = sNotes * 2;
    const rate  = maxEx > 0 ? Math.min(Math.round(ex / maxEx * 10000) / 100, 100) : 0;

    return {
      state: "result",
      song: song ? {
        title:  song.title,
        artist: fullArtist,
        genre:  song.genre || "",
        level:  sLevel,
        bpm:    sBpm,
        notes:  sNotes,
      } : null,
      chart: {
        keys:  keyLabel(mode),
        level: sLevel,
        diff:  diffLabel(song?.difficulty),
        label: `${keyLabel(mode)} ☆${sLevel || "?"}`,
      },
      score: {
        exScore: ex,
        combo,
        miss,
        rate,
        clear: clearLabel(clear),
        pgreat, great, good, bad, poor,
      },
    };
  } catch (e) {
    console.error("[score] 읽기 오류:", e.message);
    return null;
  } finally {
    try { sdb?.close(); } catch {}
    try { gdb?.close(); } catch {}
  }
}

// ─── 커스텀 API 프록시 ────────────────────────────────────────────────────────

async function fetchCustomApi(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── 플레이어 이름 ────────────────────────────────────────────────────────────

function readPlayerName(gameDir) {
  if (!gameDir) return "Player";
  const playerRoot = path.join(gameDir, "player");
  if (!fs.existsSync(playerRoot)) return "Player";
  const folders = fs.readdirSync(playerRoot)
    .filter((f) => fs.statSync(path.join(playerRoot, f)).isDirectory());
  for (const folder of folders) {
    // config_player.json (beatoraja 0.8+ / lr2oraja) 우선, config.json fallback
    for (const cfgName of ["config_player.json", "config.json"]) {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(playerRoot, folder, cfgName), "utf8"));
        const name = cfg.name || cfg.playerName || cfg.player;
        if (name) return name;
      } catch {}
    }
    return folder;
  }
  return "Player";
}

// ─── 초기화 / 재구성 ─────────────────────────────────────────────────────────

// 직전 적용된 설정 해시 (중복 재구성 방지)
let _lastConfigHash = "";

function applyConfig(newConfig, force = false) {
  const merged = { ...config, ...newConfig };
  const hash = JSON.stringify([merged.game, merged.method, merged.dir, merged.luaStatePath, merged.customApiUrl]);

  if (!force && hash === _lastConfigHash) {
    // 설정 변경 없음 → watcher 리셋 불필요
    return;
  }
  _lastConfigHash = hash;
  console.log("[config] 재구성 요청:", JSON.stringify(newConfig));

  // config 병합
  config = merged;

  // 모든 watcher/폴링 정리
  stopLuaWatcher();
  stopScorelogPolling();
  stopQwilightPolling();

  // 상태 리셋
  scoreData    = null;
  luaData      = null;
  luaWrittenAt = 0;

  console.log(`[config] 게임: ${config.game}`);

  if (isQwilight()) {
    // ── Qwilight ──
    config.method = "sqlite"; // Qwilight는 sqlite만 지원

    if (config.dir && config.dir.trim()) {
      dir = config.dir.trim();
      if (!fs.existsSync(path.join(dir, "SavesDir", "DB.db"))) {
        console.warn(`[config] 경고: 지정 경로에 SavesDir/DB.db 없음: ${dir}`);
      }
    } else {
      const detected = findQwilightDir() || detectQwilightProcess();
      if (detected) dir = detected;
      else if (!dir) console.warn("[config] Qwilight 경로 자동 탐지 실패");
    }

    if (dir) {
      console.log(`[config] 경로: ${dir}`);
      startQwilightPolling(dir);
    }
    return;
  }

  // ── beatoraja / lr2oraja ──
  if (config.dir && config.dir.trim()) {
    dir = config.dir.trim();
    if (!fs.existsSync(path.join(dir, "songdata.db"))) {
      console.warn(`[config] 경고: 지정 경로에 songdata.db 없음: ${dir}`);
    }
  } else {
    const detected = findDir() || detectGameProcess();
    if (detected) {
      dir = detected;
    } else if (!dir) {
      console.warn("[config] 게임 경로 자동 탐지 실패");
    }
  }

  if (dir) console.log(`[config] 경로: ${dir}`);

  if (config.method === "custom-api") {
    console.log(`[config] 탐지 방식: custom-api → ${config.customApiUrl}`);
    return;
  }

  if (config.method === "lua+sqlite") {
    const luaPath = config.luaStatePath ||
      (dir ? path.join(dir, "dmnote_state.json") : null);
    if (luaPath) startLuaWatcher(luaPath);
    else console.warn("[config] Lua 상태 파일 경로 없음");
  } else {
    console.log("[config] 탐지 방식: sqlite");
  }

  if (dir) startScorelogPolling(dir);
}

// ─── HTTP 서버 ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // ── GET /state ────────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/state") {
    let out;

    if (config.method === "custom-api" && config.customApiUrl) {
      // 커스텀 API: 프록시
      const data = await fetchCustomApi(config.customApiUrl);
      out = data ?? { state: "idle", player: null, song: null, chart: null, score: null, source: "custom-api-error" };
    } else {
      // SQLite / lua+sqlite
      const now      = Date.now();
      const luaFresh = luaData && (now - luaWrittenAt) < PLAYING_TTL * 1000;

      if (luaFresh) {
        const s = luaData.state;
        if ((s === "result") && scoreData) {
          // scorelog에는 table 필드가 없으므로 Lua에서 감지한 table/diff 보존
          const mergedChart = scoreData.chart
            ? { ...scoreData.chart, table: scoreData.chart.table || luaData?.chart?.table || "", diff: scoreData.chart.diff || luaData?.chart?.diff || "" }
            : luaData.chart;
          // 스코어 머지: scorelog 우선 (정확), Lua 판정/페이스메이커 보충
          const luaScore = luaData?.score || {};
          const mergedScore = scoreData.score
            ? {
                ...scoreData.score,
                // scorelog에 판정 데이터 없으면 Lua에서 보충
                pgreat: scoreData.score.pgreat ?? luaScore.pgreat,
                great:  scoreData.score.great  ?? luaScore.great,
                good:   scoreData.score.good   ?? luaScore.good,
                bad:    scoreData.score.bad    ?? luaScore.bad,
                poor:   scoreData.score.poor   ?? luaScore.poor,
                // combo: scorelog에 없으면 Lua maxCombo 사용
                combo:  scoreData.score.combo || luaScore.maxCombo || 0,
                // 페이스메이커 (Lua에서만 제공)
                target:     luaScore.target     || 0,
                targetDiff: luaScore.targetDiff || 0,
              }
            : luaScore;
          out = {
            state:   "result",
            player:  dir ? readPlayerName(dir) : null,
            song:    scoreData.song   ?? luaData.song,
            chart:   mergedChart,
            score:   mergedScore,
            source:  "lua+score",
          };
        } else {
          // Lua score 안전 보정 (구 버전 훅 호환 포함)
          let luaScore = luaData.score ? { ...luaData.score } : null;
          if (luaScore) {
            const maxEx = (luaData.song?.notes || 0) * 2;

            // 구 버전 훅 감지: exScore가 이론상 최대(notes×2)를 초과하면
            // 구 훅 공식 (actualEX×2 + maxEX)으로 역산하여 보정
            if (maxEx > 0 && luaScore.exScore > maxEx) {
              luaScore.exScore = Math.round((luaScore.exScore - maxEx) / 2);
            }

            // rate 재계산 (구 훅/신 훅 모두 적용)
            if (maxEx > 0) {
              luaScore.rate = Math.min(Math.round(luaScore.exScore / maxEx * 10000) / 100, 100);
            }

            // miss 보정 (신 훅: bad+poor 필드 존재 시)
            if (luaScore.miss == null && luaScore.bad != null && luaScore.poor != null) {
              luaScore.miss = (luaScore.bad || 0) + (luaScore.poor || 0);
            }

            // combo: maxCombo가 있으면 combo에 반영 (음악 선택 등에서 현재 콤보가 0일 때)
            if (luaScore.maxCombo > 0 && luaScore.maxCombo > (luaScore.combo || 0)) {
              luaScore.combo = luaScore.maxCombo;
            }
          }

          out = {
            state:   (s === "decide" || s === "play") ? "playing" : s,
            player:  dir ? readPlayerName(dir) : null,
            song:    luaData.song,
            chart:   luaData.chart,
            score:   luaScore,
            source:  "lua",
          };

          // 결과 상태 자동 감지: Lua가 "playing"이지만 scorelog가 최근 업데이트됨
          // 곡 제목이 일치할 때만 result로 전환 (다른 곡으로 이동한 경우 무시)
          if (out.state === "playing" && scoreData && lastUpdate > 0
              && (now - lastUpdate) < 10000) {
            const luaTitle   = (luaData.song?.title || "").trim();
            const scoreTitle = (scoreData.song?.title || "").trim();
            if (luaTitle && scoreTitle && luaTitle === scoreTitle) {
              const mergedChart = scoreData.chart
                ? { ...scoreData.chart,
                    table: scoreData.chart.table || luaData?.chart?.table || "",
                    diff:  scoreData.chart.diff  || luaData?.chart?.diff  || "" }
                : luaData.chart;
              out = {
                state:   "result",
                player:  dir ? readPlayerName(dir) : null,
                song:    scoreData.song ?? luaData.song,
                chart:   mergedChart,
                score:   scoreData.score,
                source:  "lua+score",
              };
            }
          }
        }
      } else if (isQwilight()) {
        // ── Qwilight ──
        if (qwScoreData) {
          out = { ...qwScoreData, source: "qwilight" };
        } else {
          out = {
            state:  "idle",
            player: dir ? readQwilightPlayerName(dir) : null,
            song:   null, chart: null, score: null,
            source: "qwilight-idle",
          };
        }
      } else if (scoreData) {
        out = {
          state:  "result",
          player: dir ? readPlayerName(dir) : null,
          ...scoreData,
          source: "score",
        };
      } else {
        out = {
          state:  "idle",
          player: dir ? readPlayerName(dir) : null,
          song:   null,
          chart:  null,
          score:  null,
          source: "none",
        };
      }
    }

    // 진단 정보 추가 (플러그인이 상태를 파악할 수 있도록)
    out._diag = {
      dir:       dir || null,
      game:      config.game,
      method:    config.method,
      watching:  isQwilight() ? !!qwPollingTimer : !!scorelogTimer,
      scorelog:  scorelogPath || null,
    };

    res.writeHead(200);
    res.end(JSON.stringify(out));
    return;
  }

  // ── GET /status ───────────────────────────────────────────────────────────
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200);
    res.end(JSON.stringify({
      config: {
        game:         config.game,
        method:       config.method,
        dir:          dir || null,
        luaStatePath: config.luaStatePath || null,
        customApiUrl: config.customApiUrl || null,
        pollInterval: config.pollInterval,
      },
      watcherActive:    isQwilight() ? !!qwPollingTimer : !!scorelogTimer,
      luaWatcherActive: !!luaWatcher,
      scorelogPath:     scorelogPath || null,
      patchInstalled:   isPatchInstalled(dir),
      lastUpdate:       lastUpdate || null,
    }));
    return;
  }

  // ── POST /config ──────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/config") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        applyConfig(parsed);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
      }
    });
    return;
  }

  // ── POST /setup ──────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/setup") {
    // Qwilight은 Lua 훅 미사용
    if (isQwilight()) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "Qwilight은 자동 설정(Lua 훅)을 사용하지 않습니다." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch {}

      // 1. 게임 경로 확정 (프로세스 감지 → 현재 dir → 자동 탐지)
      const setupDir = detectGameProcess() || dir || findDir();
      if (!setupDir) {
        res.writeHead(400);
        res.end(JSON.stringify({
          ok: false,
          error: "게임을 찾을 수 없습니다. 게임을 실행 중인지 확인하거나 경로를 직접 지정하세요.",
        }));
        return;
      }

      // 2. Lua 훅 설치 + 스킨 패치 (hookUpdateRate: 초당 업데이트 횟수)
      const hookUpdateRate = parsed.hookUpdateRate ?? 2;
      const results = setupLuaHook(setupDir, hookUpdateRate);
      if (results.errors.length > 0 && results.patched.length === 0) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, errors: results.errors }));
        return;
      }

      // 3. lua+sqlite 모드로 자동 전환 + 경로 설정
      applyConfig({
        method: "lua+sqlite",
        dir: setupDir,
        luaStatePath: path.join(setupDir, "dmnote_state.json"),
      });

      console.log(`[setup] 완료: ${setupDir} (패치 ${results.patched.length}개, 스킵 ${results.skipped.length}개, rate: ${hookUpdateRate}Hz)`);
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        dir: setupDir,
        patched: results.patched,
        skipped: results.skipped,
        errors: results.errors,
        hookUpdateRate,
        message: results.patched.length > 0
          ? "게임을 재시작하면 실시간 감지가 시작됩니다."
          : "이미 패치가 적용되어 있습니다.",
      }));
    });
    return;
  }

  // ── POST /uninstall ────────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/uninstall") {
    if (isQwilight()) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "Qwilight은 Lua 훅을 사용하지 않습니다." }));
      return;
    }
    const targetDir = dir || detectGameProcess() || findDir();
    if (!targetDir) {
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: "게임 경로를 찾을 수 없습니다." }));
      return;
    }

    const results = uninstallLuaHook(targetDir);

    // sqlite 모드로 복귀
    applyConfig({ method: "sqlite", dir: targetDir });

    console.log(`[uninstall] 완료: 복원 ${results.restored.length}개`);
    res.writeHead(200);
    res.end(JSON.stringify({
      ok: true,
      dir: targetDir,
      restored: results.restored,
      errors: results.errors,
    }));
    return;
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  res.writeHead(404);
  res.end('{"error":"not found"}');
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("═".repeat(50));
  console.log(" dmnote-bridge (beatoraja / lr2oraja / Qwilight)");
  console.log("═".repeat(50));
  console.log(` HTTP  : http://localhost:${PORT}/state`);
  console.log(` Status: http://localhost:${PORT}/status`);

  // 초기화 (CLI --game / --dir 우선 → 프로세스 감지 → 후보 경로 탐색)
  const initGame = FORCE_GAME || config.game;
  let initDir = FORCE_DIR || "";
  if (!initDir) {
    const detected = (initGame === "qwilight")
      ? (detectQwilightProcess() || findQwilightDir())
      : detectGameProcess();
    if (detected) {
      console.log(` 감지  : 게임 프로세스에서 경로 확정 → ${detected}`);
      initDir = detected;
    }
  }
  applyConfig({ dir: initDir, game: initGame }, true);

  if (!dir) {
    console.warn(" 경로  : 게임을 찾지 못했습니다.");
    console.warn("         게임을 실행한 뒤 DmNote에서 자동 설정을 실행하거나");
    console.warn("         --dir 옵션으로 직접 지정하세요.");
    // 5초마다 재탐색 (프로세스 감지 + 후보 경로)
    dirRetryTimer = setInterval(() => {
      if (dir) { clearInterval(dirRetryTimer); dirRetryTimer = null; return; }
      const found = isQwilight()
        ? (detectQwilightProcess() || findQwilightDir())
        : (detectGameProcess() || findDir());
      if (found) {
        console.log(`[init] 게임 발견: ${found}`);
        applyConfig({ dir: found });
        clearInterval(dirRetryTimer);
        dirRetryTimer = null;
      }
    }, 5000);
  }

  console.log("═".repeat(50));
  console.log(" DmNote 에서 plugin/beatoraja.js 를 로드하세요.");
  console.log("═".repeat(50));
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n[오류] 포트 ${PORT} 사용 중. --port 로 변경하세요.`);
    process.exit(1);
  }
});

process.on("SIGINT", () => {
  stopLuaWatcher();
  stopScorelogPolling();
  stopQwilightPolling();
  server.close(() => process.exit(0));
});


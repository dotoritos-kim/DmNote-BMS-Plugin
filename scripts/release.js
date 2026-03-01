/**
 * release.js
 *
 * plugin/ 폴더를 node_modules 포함하여 배포용 zip으로 패키징합니다.
 * 결과물: dist/dmnote-bms-plugin-v{version}.zip
 *
 * 사용법: npm run release
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "plugin");
const BRIDGE_DIR = path.join(PLUGIN_DIR, "beatoraja-bridge");
const DIST_DIR = path.join(ROOT, "dist");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
// CI에서 RELEASE_VERSION 환경변수로 버전 전달, 없으면 package.json fallback
const version = process.env.RELEASE_VERSION || pkg.version;

// ── 1. node_modules 확인 ────────────────────────────────────────────────────

const nodeModules = path.join(BRIDGE_DIR, "node_modules");
if (!fs.existsSync(nodeModules)) {
  console.log("[release] node_modules가 없습니다. npm install 실행 중...");
  execSync("npm install", { cwd: BRIDGE_DIR, stdio: "inherit" });
}

// ── 2. node.exe 번들링 ──────────────────────────────────────────────────────

const bundledNode = path.join(BRIDGE_DIR, "node.exe");
const nodeExeSrc = process.execPath;

console.log(`[release] node.exe 복사: ${nodeExeSrc}`);
fs.copyFileSync(nodeExeSrc, bundledNode);

const nodeSize = (fs.statSync(bundledNode).size / 1024 / 1024).toFixed(1);
console.log(`[release] node.exe (${nodeSize} MB) 번들링 완료`);

// ── 3. dist 폴더 생성 ─────────────────────────────────────────────────────

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

// ── 4. zip 생성 (PowerShell) ────────────────────────────────────────────────

const zipName = `dmnote-bms-plugin-v${version}.zip`;
const zipPath = path.join(DIST_DIR, zipName);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

console.log(`[release] ${zipName} 생성 중...`);

// PowerShell Compress-Archive 사용
const psCmd = [
  `Compress-Archive`,
  `-Path "${PLUGIN_DIR}\\*"`,
  `-DestinationPath "${zipPath}"`,
  `-Force`,
].join(" ");

execSync(`powershell -NoProfile -Command "${psCmd}"`, {
  stdio: "inherit",
});

// ── 5. 번들된 node.exe 정리 ─────────────────────────────────────────────────

if (fs.existsSync(bundledNode)) {
  fs.unlinkSync(bundledNode);
  console.log("[release] 번들된 node.exe 정리 완료");
}

const stat = fs.statSync(zipPath);
const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

console.log(`\n[release] 완료: dist/${zipName} (${sizeMB} MB)`);
console.log(`[release] 사용자: zip 압축 해제 후 DmNote에서 beatoraja.js 로드`);

# DmNote BMS Plugin

beatoraja / lr2oraja / Qwilight에서 플레이 중인 곡 정보를 [DmNote](https://github.com/nicenote/DmNote) 패널에 실시간으로 표시하는 플러그인입니다.

## 사용자 가이드 (배포 파일 받은 경우)

### 설치

1. 배포받은 zip 파일의 압축을 해제합니다.
2. DmNote 실행 → 설정 → JS 플러그인 → `beatoraja.js` 로드
3. 오버레이 우클릭 → **"BMS Now Playing 패널 생성"**

브릿지 서버는 플러그인 로드 시 자동으로 시작됩니다.

### 설정

패널 우클릭 → **서버 설정**에서 구성:

- **구동기**: beatoraja/lr2oraja 또는 Qwilight 선택
- **탐지 방식**: SQLite 폴링 (기본) / Lua+SQLite (실시간) / 커스텀 API
- **게임 경로**: 비워두면 자동 탐지

자세한 설정 및 API 문서는 [beatoraja-bridge README](plugin/beatoraja-bridge/README.md)를 참고하세요.

---

## 개발자 가이드

### 요구사항

- Node.js 18+
- Windows (better-sqlite3 네이티브 모듈 빌드 필요)

### 셋업

```bash
git clone <this-repo>
cd DmNote-BMS-Plugin
npm run install:bridge
```

### 프로젝트 구조

```
plugin/
├── beatoraja.js              ← DmNote가 로드하는 메인 플러그인
├── beatoraja-bridge/          ← 게임 상태 브릿지 서버 (Node.js)
│   ├── index.js               ← HTTP 서버 (localhost:54321)
│   ├── dmnote_hook.lua        ← 실시간 감지용 Lua 훅
│   ├── dmnote-bridge.lua      ← 수동 Lua 설치용
│   ├── package.json
│   └── package-lock.json
├── kps.js                     ← KPS 미터 플러그인
├── keystroke-visualizer.js    ← 키스트로크 시각화
├── record.js                  ← 키스트로크 녹화
└── v-archive-tier.js          ← V-Archive 티어 표시
```

### 릴리스 (배포 파일 생성)

```bash
npm run release
```

`dist/dmnote-bms-plugin-v{version}.zip` 파일이 생성됩니다.
이 zip에는 `plugin/` 폴더 전체가 `node_modules` 포함으로 패키징되어 있어, 사용자는 압축 해제 후 바로 DmNote에서 사용할 수 있습니다.

### 개발 모드 (브릿지 서버 단독 실행)

```bash
cd plugin/beatoraja-bridge
npm run dev
```

## 라이선스

MIT

# DmNote Bridge (beatoraja / lr2oraja / Qwilight)

beatoraja, lr2oraja, Qwilight 등에서 플레이한 곡·차분·플레이어 이름을 DmNote 패널에 표시합니다.
**게임을 전혀 수정하지 않아도 됩니다.**

---

## 동작 방식

```
[beatoraja / lr2oraja]
  └─ scorelog.db 자동 갱신 (플레이 완료마다)
  └─ dmnote_state.json (Lua 스킨 설치 시, 선곡 즉시)

[Qwilight]
  └─ DB.db (SavesDir/) 자동 갱신

[bridge server: index.js]  ← 한 번 실행
  ├── GET  /state    → 현재 상태 반환
  ├── GET  /status   → 서버 설정 현황
  └── POST /config   → DmNote 설정 패널에서 동적 재구성

[DmNote plugin: beatoraja.js]
  └── 2초마다 /state 폴링 → 패널 자동 업데이트
      설정 변경 시 /config 자동 전송
```

---

## 탐지 메커니즘

### beatoraja / lr2oraja

| 방식 | 정보 타이밍 | 게임 수정 |
|------|-----------|----------|
| **SQLite 폴링** (기본) | 플레이 완료 후 | 없음 |
| **Lua 파일 + SQLite** (선택) | 선곡 순간 즉시 | 스킨에 2줄 추가 |
| **커스텀 HTTP API** (선택) | API 의존 | 없음 |

### Qwilight

| 방식 | 정보 타이밍 | 게임 수정 |
|------|-----------|----------|
| **SQLite 폴링** (기본) | 플레이 완료 후 | 없음 |

---

## 설치 및 실행

### 1. 의존성 설치

```bash
cd beatoraja-bridge
npm install
```

### 2. 서버 실행

```bash
node index.js
```

게임 경로가 자동으로 탐지됩니다 (실행 중인 프로세스 감지 + 후보 경로 탐색).
탐지 실패 시:
```bash
node index.js --dir "D:/Games/beatoraja"
node index.js --dir "D:/Games/lr2oraja"
```

Qwilight 모드:
```bash
node index.js --game qwilight
```

포트 변경:
```bash
node index.js --port 54322
```

### 3. DmNote에서 플러그인 로드

1. DmNote 실행
2. 설정 → JS 플러그인 → `plugin/beatoraja.js` 로드
3. 오버레이 우클릭 → **"BMS Now Playing 패널 생성"**
4. 서버 설정에서 구동기를 선택 (beatoraja/lr2oraja 또는 Qwilight)
5. 플러그인이 자동으로 브릿지 서버에 연결 및 설정 전송

---

## DmNote 설정 패널

플러그인 로드 후 DmNote 설정에서 구성 가능합니다.

### 브릿지 서버 섹션
- **호스트**: 브릿지 서버 주소 (기본: `http://localhost`)
- **포트**: 브릿지 서버 포트 (기본: `54321`)

### 탐지 메커니즘 섹션
- **구동기**: beatoraja/lr2oraja 또는 Qwilight 선택
- **탐지 방식**: SQLite 폴링 / Lua 파일+SQLite / 커스텀 HTTP API (Qwilight는 SQLite만)
- **경로**: 게임 설치 경로 — 비워두면 자동 탐지
- **Lua 상태 파일 경로**: `lua+sqlite` 방식 사용 시 (기본: `<게임 경로>/dmnote_state.json`)
- **커스텀 API URL**: `custom-api` 방식 사용 시

### 고급 섹션
- **폴링 간격**: 상태 확인 주기 (초, 기본: 2)
- **훅 빈도**: Lua 훅 업데이트 빈도 (Hz, 기본: 2)

설정을 변경하면 브릿지 서버에 자동으로 `POST /config`가 전송되어 즉시 반영됩니다.

---

## 선택 사항: Lua 파일 감시 (선곡 즉시 표시)

SQLite 폴링만으로는 플레이 **완료 후** 정보가 표시됩니다.
선곡 **순간**부터 표시하려면 Lua 스킨에 스크립트를 추가하고 탐지 방식을 변경하세요.

### Lua 스킨 설치

1. `dmnote-bridge.lua`를 스킨 폴더에 복사
   ```
   C:\beatoraja\skin\MySkin\dmnote-bridge.lua
   C:\lr2oraja\skin\MySkin\dmnote-bridge.lua
   ```

2. 스킨 메인 `.lua` 파일 제일 위에 추가:
   ```lua
   dofile(skin.path .. "dmnote-bridge.lua")
   ```

3. 스킨 `update()` 함수 내부에 추가:
   ```lua
   function update()
     DMNOTE_update()  -- 이 줄 추가
     -- 기존 코드 ...
   end
   ```

4. DmNote 설정 → 탐지 방식을 **"Lua 파일 + SQLite"** 로 변경

---

## 자동 탐지 경로

서버가 다음 경로에서 게임을 자동으로 찾습니다:

- `C:/beatoraja`, `D:/beatoraja`
- `C:/Games/beatoraja`, `D:/Games/beatoraja`
- `C:/Users/Public/beatoraja`
- `C:/lr2oraja`, `D:/lr2oraja`
- `C:/Games/lr2oraja`, `D:/Games/lr2oraja`
- `C:/Users/Public/lr2oraja`
- 서버 실행 디렉토리 및 상위 폴더

또한 실행 중인 beatoraja/lr2oraja 프로세스를 `wmic`으로 감지하여 경로를 자동 확정합니다.

---

## 환경변수 / CLI 옵션

| 옵션 | 환경변수 | 기본값 | 설명 |
|------|----------|--------|------|
| `--dir` | `BEATORAJA_DIR` 또는 `LR2ORAJA_DIR` | 자동 탐지 | 게임 설치 경로 |
| `--game` | — | `beatoraja` | 게임 종류 (`beatoraja` / `qwilight`) |
| `--port` | `PORT` | `54321` | HTTP 서버 포트 |

---

## API 엔드포인트

### `GET /state`

현재 상태 반환:

```json
{
  "state": "result",
  "player": "Nucle",
  "song": { "title": "FREEDOM DiVE↓", "artist": "xi", "level": 12, "bpm": 222.22 },
  "chart": { "keys": "7KEY", "level": 12, "diff": "ANOTHER", "label": "7KEY ☆12" },
  "score": { "exScore": 2841, "combo": 312, "miss": 5, "rate": 95.43, "clear": "HARD", "pgreat": 1200, "great": 441, "good": 30, "bad": 3, "poor": 2 },
  "source": "lua+score"
}
```

`state` 값: `"idle"` / `"playing"` / `"result"`

### `GET /status`

서버 설정 현황:

```json
{
  "config": { "method": "sqlite", "dir": "C:/beatoraja", "pollInterval": 2 },
  "watcherActive": true,
  "luaWatcherActive": false,
  "scorelogPath": "C:/beatoraja/player/player1/scorelog.db",
  "patchInstalled": false,
  "lastUpdate": 1710000000000
}
```

### `POST /config`

서버 동적 재구성 (DmNote 설정 패널에서 자동 호출):

```json
{
  "method": "sqlite",
  "dir": "D:/Games/beatoraja",
  "luaStatePath": "",
  "customApiUrl": "",
  "pollInterval": 2
}
```

### `POST /setup`

Lua 스킨 자동 패치 + 실시간 감지 설정 (DmNote 플러그인이 자동 호출):

1. `wmic`으로 beatoraja/lr2oraja 프로세스 감지 → 설치 경로 확정
2. `config_player.json`에서 활성 스킨 `.luaskin` 경로 추출
3. 각 `.luaskin` 파일 자동 패치 (`.dmnote_backup` 백업)
4. `dmnote_hook.lua`를 게임 루트에 복사
5. `lua+sqlite` 모드로 자동 전환

```json
{
  "ok": true,
  "dir": "C:/Users/nucle/beatoraja0.8.8-jre-win64",
  "patched": ["skin/LITONE9/Play/play7.luaskin"],
  "skipped": [],
  "errors": [],
  "message": "게임을 재시작하면 실시간 감지가 시작됩니다."
}
```

### `POST /uninstall`

Lua 스킨 패치 제거 + 원본 복원:

```json
{
  "ok": true,
  "dir": "C:/Users/nucle/beatoraja0.8.8-jre-win64",
  "restored": ["skin/LITONE9/Play/play7.luaskin"],
  "errors": []
}
```

---

## 문제 해결

**패널에 "Bridge server not running" 표시**
→ `node index.js`가 실행 중인지 확인하세요.

**패널에 곡 정보가 안 나옴**
→ `http://localhost:54321/status`를 브라우저로 열어 `dir` 경로 확인
→ DmNote 설정 패널에서 게임 경로 직접 지정

**`npm install` 실패**
→ Node.js 18 이상이 필요합니다.
→ `better-sqlite3`는 네이티브 모듈이므로 빌드 도구 필요:
  `npm install --global windows-build-tools`

**선곡해도 즉시 표시 안 됨**
→ 플러그인이 자동으로 `POST /setup`을 호출하여 Lua 패치를 설치합니다.
→ 게임을 재시작하면 실시간 감지가 시작됩니다.
→ 자동 설정 실패 시 게임을 먼저 실행한 뒤 다시 시도하세요.

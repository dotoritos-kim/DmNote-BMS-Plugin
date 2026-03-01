--[[
  dmnote-bridge.lua  —  beatoraja/lr2oraja DmNote Bridge
  ─────────────────────────────────────────────
  플레이어가 곡을 선택하고 엔터를 누르는 순간
  곡 제목·차분·아티스트를 JSON 파일로 출력합니다.

  ■ 설치 (2단계)
  ─────────────────────────────────────────────
  1. 이 파일을 스킨 폴더에 복사합니다.
     예) C:\beatoraja\skin\MySkin\dmnote-bridge.lua
         C:\lr2oraja\skin\MySkin\dmnote-bridge.lua

  2. 스킨의 메인 .lua 파일 제일 위에 한 줄 추가:
       dofile(skin.path .. "dmnote-bridge.lua")

     그리고 스킨의 update 함수 내부에 한 줄 추가:
       function update()
         DMNOTE_update()     ← 이 줄 추가
         ... (기존 코드)
       end

  ■ OUTPUT_PATH 를 환경에 맞게 수정하세요.
  ─────────────────────────────────────────────
--]]

-- ─── 설정 ─────────────────────────────────────────────────────────────────────

-- bridge 서버(index.js)의 STATE_FILE 과 동일해야 합니다.
local DMNOTE_OUTPUT_PATH = "dmnote_state.json"

-- ─── 내부 상태 (충돌 방지를 위해 DMNOTE_ 접두어 사용) ─────────────────────────

local DMNOTE__last_written_key = nil   -- 마지막으로 파일에 쓴 "title|level|mode"
local DMNOTE__last_state       = nil   -- 마지막으로 감지한 게임 상태

-- ─── 유틸리티 ─────────────────────────────────────────────────────────────────

-- pcall 래퍼 (존재하지 않는 메서드 호출 시 에러 방지)
local function DMNOTE_safe(fn)
  local ok, v = pcall(fn)
  return ok and v or nil
end

-- 최소 JSON 문자열 이스케이프
local function DMNOTE_jstr(v)
  if v == nil then return "null" end
  v = tostring(v)
  v = v:gsub('\\', '\\\\')
       :gsub('"',  '\\"')
       :gsub('\n', '\\n')
       :gsub('\r', '\\r')
       :gsub('\t', '\\t')
  return '"' .. v .. '"'
end

-- beatoraja/lr2oraja mode 정수 → 레이블
local DMNOTE_MODE = {
  [0]="5KEY",[1]="7KEY",[2]="9KEY",[3]="10KEY",[4]="14KEY",
  [5]="5KEY-LN",[6]="7KEY-LN",[7]="9KEY-LN",[8]="14KEY-LN",
  [16]="BEAT-5K",[17]="BEAT-7K",[18]="BEAT-10K",[19]="BEAT-14K",
  [32]="POP'N-9",
}

-- ─── 메인 함수 ────────────────────────────────────────────────────────────────

--[[
  스킨의 update() 함수에서 매 프레임 호출하세요.
  내부적으로 상태 전환(엔터 누름 등)만 감지하여 파일을 씁니다.
  (상태 변화가 없으면 아무것도 하지 않습니다)
--]]
function DMNOTE_update()

  -- ── 1. 현재 게임 상태 파악 ────────────────────────────────────────────────
  --
  -- beatoraja/lr2oraja의 전역 `state` 변수는 숫자 또는 문자열입니다.
  -- 버전에 따라 다를 수 있으므로 여러 방식으로 시도합니다.

  local raw = DMNOTE_safe(function() return state end)
  local raw_str = raw ~= nil and tostring(raw):lower() or ""

  local mapped
  if raw_str:find("decide") or raw_str:find("loading") then
    mapped = "decide"   -- ★ 플레이어가 엔터를 누른 직후 (곡 로딩 중)
  elseif raw_str:find("play") and not raw_str:find("result") then
    mapped = "play"
  elseif raw_str:find("result") or raw_str:find("finish") then
    mapped = "result"
  elseif raw_str == "1" then
    mapped = "decide"   -- 일부 버전: 숫자 상태
  elseif raw_str == "2" then
    mapped = "play"
  elseif raw_str == "3" then
    mapped = "result"
  else
    mapped = "select"
  end

  -- ── 2. 곡 정보 읽기 ───────────────────────────────────────────────────────
  --
  -- select 화면에서는 "지금 커서가 올려진 곡"이 반환됩니다.
  -- decide/play 에서는 "방금 선택한 곡"이 반환됩니다.

  local title  = DMNOTE_safe(function() return SkinLuaAccessor:getTitle()  end) or ""
  local artist = DMNOTE_safe(function() return SkinLuaAccessor:getArtist() end) or ""
  local level  = DMNOTE_safe(function() return SkinLuaAccessor:getLevel()  end) or 0
  local bpm    = DMNOTE_safe(function() return SkinLuaAccessor:getBpm()    end) or 0
  local mode_n = DMNOTE_safe(function() return SkinLuaAccessor:getMode()   end) or 1

  if title == "" then return end  -- 곡 정보 없음 (초기화 중 등)

  -- ── 3. 파일에 쓸 타이밍 결정 ─────────────────────────────────────────────
  --
  -- 파일을 쓰는 조건:
  --   A) 상태가 decide/play/result 로 전환됐을 때  (엔터 누름 감지)
  --   B) decide/play/result 상태에서 곡이 바뀌었을 때 (이론상 없지만 안전망)
  -- 쓰지 않는 조건:
  --   - select 상태에서 커서만 이동할 때 (탐색 중 스팸 방지)

  local song_key = title .. "|" .. level .. "|" .. mode_n
  local state_changed = (mapped ~= DMNOTE__last_state)
  local song_changed  = (song_key ~= DMNOTE__last_written_key)

  local should_write = false
  if mapped == "decide" then
    -- 엔터를 누른 순간 — 항상 씀
    should_write = true
  elseif mapped == "play" or mapped == "result" then
    -- play/result 진입 시 상태 또는 곡이 바뀌었을 때
    should_write = state_changed or song_changed
  end
  -- select 상태는 의도적으로 쓰지 않음

  DMNOTE__last_state = mapped
  if not should_write then return end

  -- ── 4. JSON 출력 ──────────────────────────────────────────────────────────

  DMNOTE__last_written_key = song_key

  local mode_label = DMNOTE_MODE[mode_n] or (mode_n .. "KEY")
  local chart_label = mode_label .. " \xe2\x98\x86" .. level  -- ☆ (UTF-8)

  local json = string.format(
    '{"state":%s,"song":{"title":%s,"artist":%s,"level":%d,"bpm":%g},"chart":{"keys":%s,"level":%d,"label":%s},"timestamp":%d}',
    DMNOTE_jstr(mapped),
    DMNOTE_jstr(title),
    DMNOTE_jstr(artist),
    level,
    bpm,
    DMNOTE_jstr(mode_label),
    level,
    DMNOTE_jstr(chart_label),
    os.time() * 1000
  )

  local f = io.open(DMNOTE_OUTPUT_PATH, "w")
  if f then
    f:write(json)
    f:close()
  end
end

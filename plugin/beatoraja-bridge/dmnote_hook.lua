--[[
  dmnote_hook.lua — beatoraja/lr2oraja DmNote Bridge (luaskin universal hook)

  이 파일은 beatoraja/lr2oraja 설치 폴더 루트에 배치됩니다.
  .luaskin 파일이 자동 패치되어 이 파일을 로드하고,
  스킨 테이블에 보이지 않는 destination을 삽입하여
  주기적으로 곡 정보를 dmnote_state.json에 기록합니다.

  수동 설치 불필요 — bridge 서버의 POST /setup 이 자동으로 처리합니다.
--]]

local main_state = require("main_state")

-- ── 설정 ────────────────────────────────────────────────────────────────────

local DMNOTE_OUTPUT    = "dmnote_state.json" -- 게임 CWD 기준
local DMNOTE_INTERVAL  = 0.5                 -- 초 단위 (bridge 서버가 복사 시 덮어씀)
local DMNOTE_HEARTBEAT = 5                   -- 하트비트 간격 (초) — 종료 감지용

-- ── 내부 상태 ───────────────────────────────────────────────────────────────

local DMNOTE__last_key       = nil
local DMNOTE__last_time      = 0
local DMNOTE__last_heartbeat = 0

-- ── JSON 이스케이프 ─────────────────────────────────────────────────────────

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

-- 키 모드 감지: main_state.option() op codes (beatoraja 스킨 표준 방식)
local DMNOTE_MODE_OPCODES = {
  {160, "7KEY"},
  {161, "5KEY"},
  {162, "14KEY"},
  {163, "10KEY"},
  {164, "9KEY"},
  {1160, "24KEY"},
  {1161, "48KEY"},
}

local function DMNOTE_detect_mode()
  for _, entry in ipairs(DMNOTE_MODE_OPCODES) do
    local ok, result = pcall(function() return main_state.option(entry[1]) end)
    if ok and result then
      return entry[2]
    end
  end
  return "7KEY" -- default
end

-- 난이도 감지: main_state.option() op codes
local DMNOTE_DIFF_OPCODES = {
  {170, "BEGINNER"}, {171, "NORMAL"}, {172, "HYPER"},
  {173, "ANOTHER"}, {174, "INSANE"},
}

local function DMNOTE_detect_diff()
  for _, entry in ipairs(DMNOTE_DIFF_OPCODES) do
    local ok, result = pcall(function() return main_state.option(entry[1]) end)
    if ok and result then
      return entry[2]
    end
  end
  return nil
end

-- ── 숫자값 유효성 검증 (Java Integer.MIN_VALUE 오버플로우 방지) ────────────────

local function DMNOTE_clamp(v, lo, hi)
  if v < lo or v > hi then return 0 end
  return v
end

-- ── 안전한 숫자 읽기 ────────────────────────────────────────────────────────

local function DMNOTE_num(id, lo, hi)
  local ok, v = pcall(function() return main_state.number(id) end)
  if not ok or type(v) ~= "number" then return 0 end
  return DMNOTE_clamp(v, lo, hi)
end

-- ── 상태 기록 함수 (throttle 통과 시에만 호출됨) ─────────────────────────────

local function DMNOTE_write_state()
  -- main_state API로 곡 정보 수집
  local title_ok,  title     = pcall(function() return main_state.text(10) end)
  local artist_ok, artist    = pcall(function() return main_state.text(14) end)
  local sub_ok,    subartist = pcall(function() return main_state.text(15) end)
  local genre_ok,  genre     = pcall(function() return main_state.text(13) end)

  title     = title_ok  and title     or ""
  artist    = artist_ok and artist    or ""
  subartist = sub_ok    and subartist or ""
  genre     = genre_ok  and genre     or ""

  local level = DMNOTE_num(96, 0, 999)
  local bpm   = DMNOTE_num(90, 0, 99999)
  local notes = DMNOTE_num(74, 0, 999999)

  -- subartist 합치기
  if subartist ~= "" then
    artist = artist .. " " .. subartist
  end

  if title == "" then return end

  -- 테이블(난이도표) 레벨 표시
  local tbl1_ok, tbl1 = pcall(function() return main_state.text(1001) end)
  local tbl2_ok, tbl2 = pcall(function() return main_state.text(1002) end)
  tbl1 = tbl1_ok and tbl1 or ""
  tbl2 = tbl2_ok and tbl2 or ""
  local table_label = ""
  if tbl1 ~= "" and tbl2 ~= "" then
    table_label = tbl1 .. " " .. tbl2
  else
    table_label = tbl1 .. tbl2
  end

  -- 키 모드 (main_state.option op codes로 감지)
  local mode_label = DMNOTE_detect_mode()

  -- 난이도 감지
  local diff_label = DMNOTE_detect_diff()

  -- ── 실시간 스코어/판정/페이스메이커 ──
  -- beatoraja main_state number IDs:
  --   71 = EX SCORE, 73 = target EX, 74 = total notes,
  --   75 = max combo, 76 = current combo,
  --   110-114 = PGREAT/GREAT/GOOD/BAD/POOR
  local exscore  = DMNOTE_num(71,  0, 999999)
  local combo    = DMNOTE_num(76,  0, 999999)
  local maxcombo = DMNOTE_num(75,  0, 999999)
  local pgreat   = DMNOTE_num(110, 0, 999999)
  local great    = DMNOTE_num(111, 0, 999999)
  local good     = DMNOTE_num(112, 0, 999999)
  local bad      = DMNOTE_num(113, 0, 999999)
  local poor     = DMNOTE_num(114, 0, 999999)
  local target   = DMNOTE_num(73,  0, 999999)
  local miss     = bad + poor

  -- rate 계산: exScore / maxExScore * 100
  local maxex = notes * 2
  local rate  = maxex > 0 and math.floor(exscore / maxex * 10000 + 0.5) / 100 or 0

  -- targetDiff는 음수 가능 (현재 - 타겟)
  local tdiff_ok, tdiff = pcall(function() return main_state.number(78) end)
  if not tdiff_ok or type(tdiff) ~= "number" then tdiff = 0 end
  tdiff = DMNOTE_clamp(tdiff, -999999, 999999)

  -- 중복 쓰기 방지 + 하트비트
  -- dedup: 곡+레벨+모드+스코어 동일하면 파일 I/O 스킵
  -- 하트비트: HEARTBEAT 간격마다 강제 쓰기 (bridge의 종료 감지용)
  local now = os.clock()
  local key = title .. "|" .. level .. "|" .. mode_label .. "|" .. exscore
  local force = (now - DMNOTE__last_heartbeat) >= DMNOTE_HEARTBEAT

  if key == DMNOTE__last_key and not force then return end
  DMNOTE__last_key = key
  if force then DMNOTE__last_heartbeat = now end

  -- 차분 레이블
  local chart_label = mode_label .. " \xe2\x98\x86" .. level -- ☆ (UTF-8)

  local json = string.format(
    '{"state":"playing",'
    .. '"song":{"title":%s,"artist":%s,"genre":%s,"level":%d,"bpm":%g,"notes":%d},'
    .. '"chart":{"keys":%s,"level":%d,"label":%s,"table":%s,"diff":%s},'
    .. '"score":{"exScore":%d,"rate":%g,"combo":%d,"maxCombo":%d,"miss":%d,"pgreat":%d,"great":%d,"good":%d,"bad":%d,"poor":%d,"target":%d,"targetDiff":%d},'
    .. '"timestamp":%d}',
    DMNOTE_jstr(title),
    DMNOTE_jstr(artist),
    DMNOTE_jstr(genre),
    level, bpm, notes,
    DMNOTE_jstr(mode_label),
    level,
    DMNOTE_jstr(chart_label),
    DMNOTE_jstr(table_label),
    DMNOTE_jstr(diff_label),
    exscore, rate, combo, maxcombo, miss,
    pgreat, great, good, bad, poor,
    target, tdiff,
    os.time() * 1000
  )

  local f = io.open(DMNOTE_OUTPUT, "w")
  if f then
    f:write(json)
    f:close()
  end
end

-- ── 스킨 테이블 인젝션 ─────────────────────────────────────────────────────

function DMNOTE_inject(skin)
  if not skin then return end

  -- destination 배열이 없으면 생성
  if not skin.destination then
    skin.destination = {}
  end

  -- 보이지 않는 destination 추가
  -- draw 콜백: 매 프레임 호출되지만 hot path는 os.clock() 비교만 수행
  table.insert(skin.destination, {
    id = -1, loop = -1,
    draw = function()
      -- 시간 기반 throttle (pcall 밖에서 처리 → 최소 오버헤드)
      -- DMNOTE_INTERVAL <= 0 이면 매 프레임 호출 (쓰로틀 없음)
      if DMNOTE_INTERVAL > 0 then
        local now = os.clock()
        if now - DMNOTE__last_time < DMNOTE_INTERVAL then return false end
        DMNOTE__last_time = now
      end
      pcall(DMNOTE_write_state)
      return false -- 보이지 않음
    end,
    dst = {{x = 0, y = 0, w = 0, h = 0, a = 0}}
  })
end

@echo off
cd /d "%~dp0"

if exist "%~dp0node.exe" (
  "%~dp0node.exe" index.js %*
) else (
  where node >nul 2>&1
  if %ERRORLEVEL%==0 (
    node index.js %*
  ) else (
    echo [ERROR] Node.js not found.
    echo Install Node.js from https://nodejs.org or use the release build.
  )
)

pause

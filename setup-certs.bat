@echo off
title Luca MCP — Certificate Setup
echo ============================================
echo  Luca MCP Server - TLS Certificate Setup
echo ============================================
echo.

REM ── Step 1: Find or install mkcert ──────────────────────────────────────────

REM First try: mkcert already on PATH in this session
where mkcert >nul 2>&1
if %ERRORLEVEL% EQU 0 goto :mkcert_found

REM Second try: winget puts shims here; PATH may not be updated yet in this session
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\mkcert.exe" (
    set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
    goto :mkcert_found
)

REM Not found — install via winget
echo mkcert is not installed. Installing via winget...
echo.
winget install FiloSottile.mkcert --accept-source-agreements --accept-package-agreements

REM Refresh PATH from registry so mkcert is usable in this session
echo Refreshing PATH...
for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User')"`) do set "PATH=%%A"

REM Try the winget shim location as a fallback
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\mkcert.exe" (
    set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
)

REM Final check
where mkcert >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  mkcert still not found after install. This can happen if winget
    echo  installed it to an unexpected location. Please:
    echo.
    echo  1. Close this window
    echo  2. Open a NEW Command Prompt  (PATH will be updated^)
    echo  3. Run setup-certs.bat again
    echo.
    pause
    exit /b 1
)

:mkcert_found
echo mkcert is available.
echo.

REM ── Step 2: Install the local CA into the system trust store ────────────────
echo Installing local CA into system trust store...
echo (A UAC prompt may appear - click Yes to allow)
echo.
mkcert -install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  CA installation failed. Try running this script as Administrator:
    echo  right-click setup-certs.bat and choose "Run as administrator".
    echo.
    pause
    exit /b 1
)

REM ── Step 3: Generate the localhost certificate ───────────────────────────────
if not exist certs mkdir certs

echo.
echo Generating certificate for localhost...
mkcert -cert-file certs\localhost.pem -key-file certs\localhost-key.pem localhost 127.0.0.1

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  Certificate generation failed.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Done! Certificate setup complete.
echo.
echo  Files created:
echo    certs\localhost.pem
echo    certs\localhost-key.pem
echo.
echo  You can now run start-luca-mcp.bat to
echo  start the MCP server.
echo ============================================
echo.
pause

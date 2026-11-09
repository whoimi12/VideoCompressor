@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ===================================================
echo   Video Compressor - Khoi dong
echo ===================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [Loi] Khong tim thay Node.js. Hay cai dat tu https://nodejs.org roi chay lai.
    pause
    exit /b
)

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [Canh bao] Khong tim thay FFmpeg trong PATH.
    echo Hay cai FFmpeg va them vao PATH truoc khi nen video.
    echo.
)

if not exist "node_modules" (
    echo Dang cai dat thu vien lan dau, vui long doi...
    call npm install
    if errorlevel 1 (
        echo [Loi] Cai dat thu vien that bai.
        pause
        exit /b
    )
)

echo Dang khoi dong server tai http://localhost:3000
start "" "http://localhost:3000"
node server.js

pause

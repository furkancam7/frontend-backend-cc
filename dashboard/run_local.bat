@echo off
echo ========================================
echo   Dashboard - Local Development
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Node.js is available
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Please install Node.js 18+
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo [INFO] Installing npm packages...
    npm install
)

echo.
echo [INFO] Starting Dashboard on http://localhost:3000
echo [INFO] Make sure Command Center is running on port 8000
echo [INFO] Press Ctrl+C to stop
echo.

npm run dev

pause

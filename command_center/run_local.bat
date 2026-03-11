@echo off
echo ========================================
echo   Command Center - Local Development
echo ========================================
echo.

cd /d "%~dp0"

REM Check if Python is available
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python not found! Please install Python 3.9+
    pause
    exit /b 1
)

REM Check if venv exists, if not create it
if not exist "venv" (
    echo [INFO] Creating virtual environment...
    python -m venv venv
)

REM Activate venv
echo [INFO] Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo [INFO] Installing dependencies...
pip install -r requirements.txt -q

echo.
echo [INFO] Starting Command Center on http://localhost:8000
echo [INFO] API Docs: http://localhost:8000/docs
echo [INFO] Press Ctrl+C to stop
echo.

python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload

pause

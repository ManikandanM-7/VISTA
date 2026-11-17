@echo off
:: ============================================================
:: CogeTwin AI — One-Command Master Startup Script (Windows)
:: ============================================================
setlocal enabledelayedexpansion

:: Ensure script runs in its own directory
cd /d "%~dp0"

echo.
echo ============================================================
echo   CogeTwin AI -- Starting Industrial Digital Twin
echo ============================================================
echo.

:: 1. Verify Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found at .venv\Scripts\python.exe
    echo Please run: python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: 2. Check and clean up orphaned background processes on ports 8000 & 5000
echo [*] Checking for orphaned background processes on ports 8000, 5000...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r ":8000.*LISTENING"') do (
    echo [*] Clearing old process holding port 8000 (PID: %%a)...
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr /r ":5000.*LISTENING"') do (
    echo [*] Clearing old process holding port 5000 (PID: %%a)...
    taskkill /f /pid %%a >nul 2>&1
)

:: 3. Start MLflow Tracking Server
echo [1/3] Starting MLflow tracking server on port 5000...
start "CogeTwin MLflow" cmd /k "title CogeTwin MLflow && cd /d "%~dp0" && call .venv\Scripts\activate.bat && python -m mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri sqlite:///mlruns/mlflow.db"
timeout /t 2 /nobreak >nul

:: 4. Start FastAPI Backend
echo [2/3] Starting FastAPI backend on port 8000...
start "CogeTwin API" cmd /k "title CogeTwin API && cd /d "%~dp0" && call .venv\Scripts\activate.bat && python -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload"

:: 5. Wait for FastAPI backend to respond
echo [*] Waiting for API and AI models to initialize...
set /a attempts=0
:WAIT_API
set /a attempts+=1
timeout /t 2 /nobreak >nul
curl.exe -s http://127.0.0.1:8000/health >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Backend API is up and healthy!
    goto START_FRONTEND
)
if %attempts% lss 10 (
    echo     Initializing PyTorch ^& LangGraph agent (attempt %attempts%/10)...
    goto WAIT_API
)
echo [!] Backend is taking longer than usual, proceeding with frontend...

:START_FRONTEND
:: 6. Start Vite Frontend
echo [3/3] Starting React frontend on port 5173...
start "CogeTwin UI" cmd /k "title CogeTwin UI && cd /d "%~dp0frontend" && npm run dev"
timeout /t 3 /nobreak >nul

:: 7. Launch browser
echo.
echo ============================================================
echo   All services operational!
echo   - Digital Twin UI : http://localhost:5173
echo   - AI Chat Copilot : http://localhost:5173/chat
echo   - 3D Plant Model  : http://localhost:5173/3d-plant
echo   - FastAPI Docs    : http://localhost:8000/docs
echo   - MLflow Server   : http://localhost:5000
echo ============================================================
echo.
echo Launching CogeTwin in your browser...
start http://localhost:5173/chat

echo Press any key to exit this launcher window (services will stay running).
pause >nul

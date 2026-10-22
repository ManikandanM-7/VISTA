@echo off
:: CogeTwin — One-Command Startup Script (Windows)
:: Run this from the project root after activating .venv
:: Usage: start_all.bat

echo.
echo ============================================================
echo   CogeTwin AI -- Starting All Services
echo ============================================================
echo.

:: Check virtual environment
if not exist ".venv\Scripts\activate.bat" (
    echo ERROR: Virtual environment not found. Run: python -m venv .venv
    pause
    exit /b 1
)

call .venv\Scripts\activate.bat

:: Step 1 — Start MLflow tracking server in background
echo [1/3] Starting MLflow tracking server on port 5000...
start "MLflow" cmd /k ".venv\Scripts\python.exe -m mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri sqlite:///mlruns/mlflow.db"
timeout /t 3 /nobreak >nul

:: Step 2 — Start FastAPI backend
echo [2/3] Starting FastAPI backend on port 8000...
start "CogeTwin API" cmd /k ".venv\Scripts\python.exe -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload"
timeout /t 5 /nobreak >nul

:: Step 3 — Start React frontend
echo [3/3] Starting React frontend on port 5173...
start "CogeTwin UI" cmd /k "cd frontend && npm run dev"

echo.
echo ============================================================
echo   All services started!
echo   - Dashboard : http://localhost:5173
echo   - API Docs  : http://localhost:8000/docs
echo   - MLflow    : http://localhost:5000
echo ============================================================
echo.
echo Press any key to exit this launcher (services keep running)
pause >nul

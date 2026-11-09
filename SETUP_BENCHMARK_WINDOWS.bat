@echo off
setlocal
cd /d "%~dp0"
py -3.12 -c "import sys; assert sys.version_info[:2] == (3,12)" >nul 2>nul
if errorlevel 1 goto missing
py -3.12 -m venv .venv-benchmark
if errorlevel 1 goto failed
".venv-benchmark\Scripts\python.exe" -m pip install torch==2.9.1 --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 goto failed
".venv-benchmark\Scripts\python.exe" -m pip install -r requirements-benchmark.txt
if errorlevel 1 goto failed
echo Benchmark environment is ready: .venv-benchmark
echo Model weights are downloaded on first inference. See LOCAL_SETUP_RU.md.
pause
exit /b 0
:missing
echo Install Python 3.12 with the Windows Python launcher first.
pause
exit /b 1
:failed
echo Setup did not complete. Read the error above and check the internet connection.
pause
exit /b 1

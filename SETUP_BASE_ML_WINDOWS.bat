@echo off
setlocal
cd /d "%~dp0"
py -3.12 -c "import sys; assert sys.version_info[:2] == (3,12)" >nul 2>nul
if errorlevel 1 goto missing
py -3.12 -m venv .venv-base
if errorlevel 1 goto failed
".venv-base\Scripts\python.exe" -m pip install -r requirements-base.txt
if errorlevel 1 goto failed
echo Base ML environment is ready: .venv-base
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

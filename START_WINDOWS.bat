@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto check_python
py -3 -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if not errorlevel 1 goto use_py
:check_python
where python >nul 2>nul
if errorlevel 1 goto missing
python -c "import sys; assert sys.version_info >= (3,10)" >nul 2>nul
if errorlevel 1 goto missing
python "%~dp0run_local.py"
goto done
:use_py
py -3 "%~dp0run_local.py"
goto done
:missing
echo Python 3.10 or newer was not found. Python 3.12 is recommended.
echo Install Python from https://www.python.org/downloads/
echo Then extract the whole ZIP and run START_WINDOWS.bat again.
pause
exit /b 1
:done
if errorlevel 1 pause
endlocal

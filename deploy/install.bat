@echo off
rem SAMWOO-ORCA one-click installer launcher
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "install_exit=%ERRORLEVEL%"
if not "%install_exit%"=="0" pause
exit /b %install_exit%

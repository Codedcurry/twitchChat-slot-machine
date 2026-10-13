@echo off
cd /d "%~dp0"
start "" http://localhost:7878/control
node server.js
pause

@echo off
chcp 65001 >nul
title Prueba del chat de TikTok LIVE Studio
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --no-audit --no-fund
)
node --env-file-if-exists=.env scripts/studio-test.js
pause

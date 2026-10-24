@echo off
chcp 65001 >nul
title Coordenadas del chat de TikTok LIVE Studio
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --no-audit --no-fund
)
node scripts/studio-coords.js
pause

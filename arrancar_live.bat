@echo off
chcp 65001 >nul
title Servidor FlagMaster LIVE
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --no-audit --no-fund
)
rem Con .env no pregunta: el usuario sale de TIKTOK_USERNAME
if not exist .env if "%TIKTOK_USERNAME%"=="" set /p TIKTOK_USERNAME=Usuario de TikTok (sin @; Enter = modo prueba):
echo Arrancando el servidor de Node.js...  (Ctrl+C para terminar: guarda y publica el directo)
node --env-file-if-exists=.env server/index.js %TIKTOK_USERNAME%
pause

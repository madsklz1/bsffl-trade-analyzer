@echo off
title BSFFL Trade Analyzer v3.7
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Node.js was not found.&pause&exit /b 1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess; if($p){Stop-Process -Id $p -Force -ErrorAction SilentlyContinue}"
timeout /t 2 /nobreak >nul
start "BSFFL Trade Analyzer Server" /min cmd /c "cd /d ""%~dp0"" && node server.js"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..20|%%{try{$r=Invoke-WebRequest -UseBasicParsing http://localhost:3000 -TimeoutSec 1;if($r.StatusCode -eq 200){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 500};if(-not $ok){exit 1}"
if errorlevel 1 (echo Analyzer did not start.&pause&exit /b 1)
start "" "http://localhost:3000/?v=3.7"
exit

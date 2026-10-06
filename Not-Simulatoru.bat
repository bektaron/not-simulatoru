@echo off
chcp 65001 >nul
title Not Simulatoru (Coding)
rem Not Simulatoru baslatici - yalniz bu bilgisayarda (127.0.0.1) calisir, aga acilmaz.
rem Kendi klasorunden calisir (%~dp0); Kizlar Universite kopyasi 8080 kullandigi icin bu kopya 8081.
cd /d "%~dp0" || (echo Simulator klasoru bulunamadi. & pause & exit /b 1)

rem Sunucu zaten aciksa yalniz tarayiciyi ac
netstat -ano | findstr /r /c:"127.0.0.1:8081 .*LISTENING" >nul && (start "" "http://localhost:8081/docs/" & exit /b 0)

set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY where py >nul 2>&1 && set "PY=py"
if not defined PY (echo Python bulunamadi. & pause & exit /b 1)

echo Simulator aciliyor: http://localhost:8081/docs/
echo Kapatmak icin bu pencereyi kapatin veya Ctrl+C basin.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8081/docs/"
%PY% -m http.server 8081 --bind 127.0.0.1
pause

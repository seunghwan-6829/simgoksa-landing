@echo off
chcp 65001 >nul
title 심곡사 랜딩페이지
cd /d "%~dp0"

rem 이미 서버가 떠 있으면 브라우저만 연다
netstat -ano | findstr ":8931 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    start "" http://localhost:8931
    exit /b
)

rem python이 있으면 로컬 서버로 실행 (영상 자동재생에 가장 안정적)
where python >nul 2>&1
if %errorlevel%==0 (
    echo 심곡사 랜딩페이지 서버를 시작합니다...
    start "simgoksa-server" /min python -m http.server 8931
    timeout /t 1 >nul
    start "" http://localhost:8931
    echo.
    echo 브라우저가 열렸습니다. 이 창은 닫아도 됩니다.
    echo ^(서버 종료: 작업표시줄의 simgoksa-server 창을 닫으세요^)
    timeout /t 3 >nul
    exit /b
)

rem python이 없으면 파일로 직접 연다
start "" "%~dp0index.html"

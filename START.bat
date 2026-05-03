@echo off
cd /d "%~dp0"

echo ================================
echo   OPTIRAX – start serwera
echo ================================
echo.

:: Sprawdz czy node_modules istnieje
if not exist "node_modules" (
  echo Pierwsza instalacja – pobieranie zaleznosci...
  npm install
  echo.
)

echo Uruchamianie serwera na http://localhost:3001
echo Zamknij to okno zeby zatrzymac serwer.
echo.

:: Odczekaj 2 sekundy i otworz przegladarke
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3001"

:: Uruchom serwer (blokuje okno)
node server.js

pause

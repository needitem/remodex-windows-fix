@echo off
setlocal EnableExtensions

set "ROOT=%~dp0"
pushd "%ROOT%" >nul 2>&1 || (
  echo [remodex] Failed to open repo directory: %ROOT%
  exit /b 1
)

set "RELAY_URL=%~1"
if not defined RELAY_URL set "RELAY_URL=wss://remodex-relay.th07290828.workers.dev/relay"
set "PAIRING_PNG=%USERPROFILE%\.remodex\pairing-qr.png"
set "PAIRING_JSON=%USERPROFILE%\.remodex\pairing-qr.json"

echo [remodex] Relay: %RELAY_URL%
echo [remodex] Stopping existing Remodex bridge processes...
powershell -NoProfile -Command "$bridges = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*bin\remodex.js* up*' }); $bridgeIds = @($bridges | ForEach-Object { $_.ProcessId }); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*codex.js* app-server*' -and $bridgeIds -contains $_.ParentProcessId } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; $bridges | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

echo [remodex] Resetting saved pairing state...
set "REMODEX_RELAY=%RELAY_URL%"
node "%ROOT%bin\remodex.js" reset-pairing
if errorlevel 1 goto :fail

if exist "%PAIRING_PNG%" del /f /q "%PAIRING_PNG%" >nul 2>&1
if exist "%PAIRING_JSON%" del /f /q "%PAIRING_JSON%" >nul 2>&1

echo [remodex] Starting bridge in a new window...
start "Remodex Fresh QR" powershell -NoExit -Command "$env:REMODEX_RELAY='%RELAY_URL%'; Set-Location '%ROOT%'; node '.\bin\remodex.js' up"
if errorlevel 1 goto :fail

call :wait_for_qr
if exist "%PAIRING_PNG%" if exist "%PAIRING_JSON%" (
  echo [remodex] Opening QR image: %PAIRING_PNG%
  start "" "%PAIRING_PNG%"
) else (
  echo [remodex] QR artifacts were not created yet. Check the Remodex Fresh QR window.
)

popd >nul
exit /b 0

:wait_for_qr
for /l %%I in (1,1,20) do (
  if exist "%PAIRING_PNG%" if exist "%PAIRING_JSON%" goto :eof
  timeout /t 1 /nobreak >nul
)
goto :eof

:fail
echo [remodex] Failed to prepare a fresh QR.
popd >nul
exit /b 1

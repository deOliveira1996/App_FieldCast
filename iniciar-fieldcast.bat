@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo   FieldCast - Previsao Meteorologica Local e Campo
echo   Inicializando Servidor PWA Offline-First (Porta 4173)
echo ========================================================

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" (
        set "PATH=E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs;%PATH%"
    )
)

if not exist "dist\index.html" (
    echo [INFO] Build de producao nao encontrado em dist\. Compilando agora...
    call npm run build
)

echo.
echo [OK] Abrindo FieldCast em http://127.0.0.1:4173 ...
echo Pressione Ctrl+C para encerrar o servidor.
echo.
call npx vite preview --port 4173 --host 127.0.0.1 --open
pause

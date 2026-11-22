@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo   FieldCast - Pipeline Completo de Compilacao e Testes
echo ========================================================

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" (
        set "PATH=E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs;%PATH%"
    )
)

echo [1/4] Gerando icones PWA e assets Capacitor...
call npm run icons:generate
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [2/4] Verificando tipagem TypeScript (tsc --noEmit)...
call npx tsc --noEmit
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [3/4] Executando suite de testes unitarios (Vitest)...
call npm run test
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [4/4] Gerando bundle de producao PWA (dist/)...
call npm run build
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo ========================================================
echo   [SUCESSO] FieldCast compilado com sucesso em dist\
echo ========================================================
pause
exit /b 0

:error
echo.
echo [ERRO] Falha durante o pipeline de compilacao.
pause
exit /b 1

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

echo [1/5] Gerando icones PWA, assets e mipmaps Android...
call npm run icons:generate
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [2/5] Verificando tipagem TypeScript (tsc --noEmit)...
call npx tsc --noEmit
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [3/5] Executando suite de testes unitarios (Vitest)...
call npm run test
if %ERRORLEVEL% NEQ 0 goto :error

echo.
echo [4/5] Gerando bundle de producao PWA (dist/)...
call npm run build
if %ERRORLEVEL% NEQ 0 goto :error

if exist "android" (
    echo.
    echo [5/5] Sincronizando projeto Capacitor Android...
    call npx cap sync android
    if %ERRORLEVEL% NEQ 0 goto :error
)

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

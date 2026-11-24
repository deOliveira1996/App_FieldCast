@echo off
setlocal
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node "%~dp0safety-gate.mjs"
  exit /b %ERRORLEVEL%
)
if exist "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" (
  "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" "%~dp0safety-gate.mjs"
  exit /b %ERRORLEVEL%
)
echo {}
exit /b 0

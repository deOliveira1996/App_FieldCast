@echo off
where node >nul 2>nul
if errorlevel 1 goto vsnode
node "%~dp0safety-gate.mjs"
exit /b %errorlevel%
:vsnode
if not exist "E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" goto fallback
"E:\Microsoft Visual Studio18\Community\MSBuild\Microsoft\VisualStudio\NodeJs\node.exe" "%~dp0safety-gate.mjs"
exit /b %errorlevel%
:fallback
echo {}
exit /b 0
@echo off
setlocal
title THEO REVERSE - installer
set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.theo.reverse"

echo.
echo   ====================================
echo      THEO REVERSE  -  installer
echo   ====================================
echo.

if not exist "%SRC%index.html" ( echo   ERROR: run this from the THEO REVERSE folder ^(the one with index.html^). & echo. & pause & exit /b 1 )

echo   Enabling extensions...
for %%V in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

echo   Installing to: %DEST%
if not exist "%DEST%" mkdir "%DEST%" >nul 2>&1
robocopy "%SRC%." "%DEST%" /E /NFL /NDL /NJH /NJS /NP /XF install.bat INSTALL.txt .gitignore .gitattributes README.md version.json /XD .git >nul
if errorlevel 8 ( echo. & echo   ERROR: couldn't copy files - see INSTALL.txt for manual steps. & echo. & pause & exit /b 1 )

echo.
echo   Done!  Now:
echo     1) Fully close After Effects if it's open
echo     2) Open After Effects
echo     3) Window ^> Extensions ^> THEO REVERSE
echo.
pause

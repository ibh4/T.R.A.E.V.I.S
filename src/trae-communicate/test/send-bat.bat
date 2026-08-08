@echo off
setlocal

title TRAE Prompt Sender

cd /d "%~dp0.."

if exist ".venv\Scripts\activate.bat" (
  call ".venv\Scripts\activate.bat"
)

echo.
echo ===============================
echo    TRAE IDE Prompt Quick Send
echo ===============================
echo.
echo Please choose:
echo   1 - Continue next step
echo   2 - New feature recommendation
echo   3 - Work report
echo   0 - Exit
echo.

:INPUT
set "choice="
set /p "choice=Input [1/2/3/0]: "

if "%choice%"=="0" goto EXIT
if "%choice%"=="1" goto SEND1
if "%choice%"=="2" goto SEND2
if "%choice%"=="3" goto SEND3

echo Invalid input. Please enter 1, 2, 3, or 0.
echo.
goto INPUT

:SEND1
call :RUN 1 "Continue next step"
goto END

:SEND2
call :RUN 2 "New feature recommendation"
goto END

:SEND3
call :RUN 3 "Work report"
goto END

:RUN
echo.
echo Sending: %~2
echo.
node test/quick-test.js %~1
exit /b %ERRORLEVEL%

:END
if "%TRAE_SEND_BAT_ONCE%"=="1" goto EXIT
echo.
echo Press any key to continue...
pause >nul
goto INPUT

:EXIT
echo.
echo Bye.
endlocal

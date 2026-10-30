@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem ============================================================================
rem  标签查询工具 · 启动器
rem
rem  特性：
rem    · 自动检测本机已安装的浏览器（查注册表，不写死路径）
rem    · 首次启动让你选一次，之后记住选择
rem    · 支持用系统默认浏览器打开
rem    · 支持手动指定便携版浏览器路径
rem    · 零依赖：不需要 Python、不需要服务器、不需要联网
rem ============================================================================

set "CFG=%~dp0_浏览器设置.txt"

if not exist "lib\library.js" (
  echo.
  echo   [!] 找不到 lib\library.js
  echo.
  echo   首次使用需要先构建数据文件：
  echo     1. 打开 build 文件夹
  echo     2. 运行 build.py（需要 Python）
  echo     3. 构建完成后重新双击本文件
  echo.
  pause
  exit /b 1
)

rem ── 命令行参数（给会用的玩家，可跳过菜单）──
rem   启动.bat default    用系统默认浏览器
rem   启动.bat reset      清空记住的选择，重新显示菜单
rem   启动.bat "<路径>"   直接用指定浏览器
if /i "%~1"=="default" ( start "" "%~dp0index.html" & exit /b 0 )
if /i "%~1"=="reset" ( del "%CFG%" >nul 2>&1 & echo. & echo   已清空浏览器选择，下次启动会重新询问。 & exit /b 0 )
if not "%~1"=="" if exist "%~1" ( start "" "%~1" "%~dp0index.html" & exit /b 0 )

if exist "%CFG%" (
  set "SAVED="
  for /f "usebackq tokens=1,* delims==" %%A in ("%CFG%") do (
    if /i "%%A"=="PATH" set "SAVED=%%B"
    if /i "%%A"=="DEFAULT" set "SAVED=DEFAULT"
  )
  if /i "!SAVED!"=="DEFAULT" goto :launch_default
  if defined SAVED if exist "!SAVED!" (
    start "" "!SAVED!" "%~dp0index.html"
    exit /b 0
  )
  echo.
  echo   [i] 上次设置的浏览器已不存在，重新选择...
  del "%CFG%" >nul 2>&1
)

set /a N=0

call :try "Microsoft Edge"      "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
call :try "Google Chrome"       "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
call :try "Google Chrome x86"   "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
call :try "Mozilla Firefox"     "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\firefox.exe"
call :try "Brave"               "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\brave.exe"
call :try "Vivaldi"             "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\vivaldi.exe"
call :try "Opera"               "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\opera.exe"
call :try "360极速浏览器"       "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\360chrome.exe"
call :try "QQ浏览器"            "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\QQBrowser.exe"
call :try "搜狗高速浏览器"      "HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\sogouexplorer.exe"

call :tryfile "Chrome 用户安装"  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
call :tryfile "Brave 用户安装"   "%LOCALAPPDATA%\BraveSoftware\Brave-Browser\Application\brave.exe"
call :tryfile "Vivaldi 用户安装" "%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe"

:menu
cls
echo.
echo   +--------------------------------------------------------------+
echo   ^|          标签查询工具 · 选择用哪个浏览器打开                ^|
echo   +--------------------------------------------------------------+
echo.
if %N%==0 (
  echo   没有自动检测到常见浏览器。
  echo.
) else (
  for /l %%i in (1,1,%N%) do (
    echo     [%%i] !BNAME%%i!
  )
  echo.
)
echo     [D] 用系统默认浏览器
echo     [M] 手动输入浏览器程序路径
echo     [Q] 退出
echo.
echo   ----------------------------------------------------------------
echo   提示：选过之后会记住，下次直接打开不再询问。
echo         想重新选，删掉本目录下的「_浏览器设置.txt」即可。
echo   ----------------------------------------------------------------
echo.
set "CH="
set /p "CH=  请输入序号后回车： "

if /i "%CH%"=="Q" exit /b 0
if /i "%CH%"=="D" (
  > "%CFG%" echo DEFAULT=1
  goto :launch_default
)
if /i "%CH%"=="M" goto :manual

set "PICK="
for /l %%i in (1,1,%N%) do (
  if "%CH%"=="%%i" set "PICK=!BPATH%%i!"
)
if not defined PICK (
  echo.
  echo   [!] 输入无效，请重新选择。
  ping -n 3 127.0.0.1 >nul
  goto :menu
)

> "%CFG%" echo PATH=%PICK%
echo.
echo   已记住选择，下次直接打开。
start "" "%PICK%" "%~dp0index.html"
exit /b 0

:manual
echo.
echo   请把浏览器的完整路径粘贴进来
echo   例如：C:\Program Files\Google\Chrome\Application\chrome.exe
echo   也可以直接把 exe 文件拖进这个窗口。
echo.
set "MP="
set /p "MP=  路径： "
if not defined MP goto :menu
set "MP=%MP:"=%"
if not exist "%MP%" (
  echo.
  echo   [!] 这个路径不存在：%MP%
  ping -n 4 127.0.0.1 >nul
  goto :menu
)
> "%CFG%" echo PATH=%MP%
echo.
echo   已记住选择，下次直接打开。
start "" "%MP%" "%~dp0index.html"
exit /b 0

:launch_default
start "" "%~dp0index.html"
exit /b 0

:try
set /a N+=1
set "BPATH%N%="
set "BNAME%N%=%~1"
set "CAND="
for /f "tokens=2,*" %%A in ('reg query "%~2" /ve 2^>nul ^| findstr /i "REG_SZ"') do (
  set "CAND=%%B"
)
if defined CAND (
  set "CAND=!CAND:"=!"
  if exist "!CAND!" (
    set "BPATH%N%=!CAND!"
    goto :eof
  )
)
set /a N-=1
goto :eof

:tryfile
set /a N+=1
set "BNAME%N%=%~1"
if exist "%~2" (
  set "BPATH%N%=%~2"
  goto :eof
)
set /a N-=1
goto :eof

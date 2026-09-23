@REM Maven Wrapper startup script (Windows)
@echo off
set ERROR_CODE=0
set MAVEN_PROJECTBASEDIR=%~dp0
if "%MAVEN_PROJECTBASEDIR:~-1%"=="\" set MAVEN_PROJECTBASEDIR=%MAVEN_PROJECTBASEDIR:~0,-1%
if exist "%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.jar" goto runm2
if exist "%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\properties-loader.cmd" (
  call "%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\properties-loader.cmd"
)
:runm2
set WRAPPER_JAR="%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.jar"
set WRAPPER_LAUNCHER=org.apache.maven.wrapper.MavenWrapperMain
if not exist %WRAPPER_JAR% goto download
goto runmvn
:download
powershell -Command "&{"^
  "$webclient = new-object System.Net.WebClient;"^
  "$webclient.DownloadFile('https://repo.maven.apache.org/maven2/org/apache/maven/wrapper/maven-wrapper/3.3.2/maven-wrapper-3.3.2.jar', '%MAVEN_PROJECTBASEDIR%\.mvn\wrapper\maven-wrapper.jar')"^
  "}"
:runmvn
"%JAVA_HOME%\bin\java.exe" %MAVEN_OPTS% -classpath %WRAPPER_JAR% %WRAPPER_LAUNCHER% %*
if ERRORLEVEL 1 goto error
goto end
:error
set ERROR_CODE=1
:end
exit /B %ERROR_CODE%

@echo off
title Inventario Laboratorio — Iniciando...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo  ERROR: El script termino con codigo %ERRORLEVEL%
    pause
)

@echo off
title Luca MCP Server
echo Starting Luca's General Ledger MCP server...
echo.

REM Check certificates exist
if not exist certs\localhost.pem (
    echo  TLS certificates not found.
    echo  Please run setup-certs.bat first.
    echo.
    pause
    exit /b 1
)

set MCP_USER_ID=luca-cowork
set DATABASE_URL=postgresql://gl_admin:gl_dev_password_change_me@localhost:5432/gl_ledger
set CHAINS_DIR=./data/chains
set JWT_SECRET=dev_jwt_secret_change_me
set NODE_ENV=development

npm run mcp:http

echo.
echo Server stopped. Press any key to close.
pause >nul

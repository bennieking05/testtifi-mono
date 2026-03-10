# PowerShell script to start dev server with correct Node version

Write-Host "🔍 Checking Node version..." -ForegroundColor Cyan

$nodeVersion = node --version
Write-Host "Current Node version: $nodeVersion" -ForegroundColor Yellow

if ($nodeVersion -match "^v14\.") {
    Write-Host "❌ Node 14 detected - Vite requires Node 16+" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please upgrade Node.js:" -ForegroundColor Yellow
    Write-Host "  Option 1: Use nvm - Run: nvm use 20" -ForegroundColor White
    Write-Host "  Option 2: Download from https://nodejs.org" -ForegroundColor White
    Write-Host ""
    Write-Host "See FIX-NODE-VERSION.md for detailed instructions" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ Node version is compatible" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Starting Vite dev server..." -ForegroundColor Cyan
Write-Host ""

# Kill any existing vite process
Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {$_.CommandLine -like "*vite*"} | Stop-Process -Force -ErrorAction SilentlyContinue

# Start dev server
npm run dev


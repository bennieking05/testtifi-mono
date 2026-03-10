# Fix Node Version Issue

## Problem
Vite 5.4.1 requires Node.js 16+ but you're running Node 14.18.1

Error: `SyntaxError: Unexpected token '??='`

## Solution

### For Windows (PowerShell)

1. **Check if nvm-windows is installed:**
```powershell
nvm version
```

2. **If nvm is installed:**
```powershell
# Install Node 20
nvm install 20.18.0

# Use Node 20
nvm use 20.18.0

# Verify
node --version
# Should show: v20.18.0
```

3. **If nvm is NOT installed, install it:**
   - Download: https://github.com/coreybutler/nvm-windows/releases
   - Install `nvm-setup.exe`
   - Restart PowerShell
   - Run steps above

### For Mac/Linux

```bash
# Install Node 20
nvm install 20

# Use Node 20
nvm use 20

# Set as default
nvm alias default 20

# Verify
node --version
```

### Alternative: Install Node Directly (No nvm)

Download and install Node 20 LTS from:
https://nodejs.org/en/download/

---

## After Upgrading Node

```powershell
# Navigate to loveable folder
cd /Users/bennieking/Sites/testifiAi/loveable

# Kill old process
pkill -f vite

# Start dev server
npm run dev
```

Should now start successfully without errors! ✅

---

## Quick Check

Run this to see your current Node version:
```powershell
node --version
```

If it shows `v14.x.x`, you haven't switched yet.
If it shows `v20.x.x`, you're good to go!


# Testifi AI — Docker Quickstart

## Local containers

Prereqs: Docker Desktop running

```bash
./scripts/docker-up.sh
# Frontend: http://localhost:3000
# Backend:  http://localhost:4000/api/health

# Stop
./scripts/docker-down.sh
```

## Notes
- Frontend image passes `VITE_API_URL=http://localhost:4000` at build time.
- Backend exposes 4000. Add env in docker-compose.yml as needed (DB, SendGrid, etc.).
# CI/CD Test - Staging Branch Sat Oct 25 14:13:47 CDT 2025
# Force sync Sat Oct 25 15:12:08 CDT 2025

## Email Theme

Transactional emails support light, dark, and auto themes.

- Configure in `backend/.env`:
  ```
  EMAIL_THEME=auto   # or: light | dark
  ```
- `auto` respects the recipient’s system theme when the client supports `prefers-color-scheme`, otherwise falls back to light.
- Our templates meet WCAG AA contrast targets, underline links by default, and keep brand color `#5674BC`.

### Test emails
Send both light and dark sample emails using inline CID logos:
```bash
DOTENV_CONFIG_PATH=backend/.env \
npx --prefix backend ts-node -P backend/tsconfig.json \
  ../scripts/test-send-inline-logo.ts
```

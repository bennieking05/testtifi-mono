# Testifi-AI — Docker Quickstart

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

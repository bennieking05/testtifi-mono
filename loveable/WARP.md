# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Overview
- SPA built with Vite + React + TypeScript
- Styling: Tailwind CSS + shadcn/ui components
- Routing: React Router
- Data fetching/caching: @tanstack/react-query
- Networking: Axios instance with auth interceptors and token refresh
- Payments: Stripe Elements
- Dev server: http://localhost:3000 (configured in vite.config.ts)
- Deploy: Static build served by Nginx (Dockerfile + nginx.conf)

Common commands
- Install dependencies (uses npm, package-lock.json is present)
  - npm ci
  - npm i
- Start dev server
  - npm run dev
- Build (production)
  - npm run build
  - npm run build:dev  # development mode build
- Preview built app locally
  - npm run preview
- Lint
  - npm run lint
- UI tests (Playwright)
  - First-time install of browsers: npm run test:ui:install
  - Run tests with a dev server auto-start: npm run test:ui
  - Headed mode (requires a running dev server on :3000): npm run test:ui:headful
  - Run a single test (two options)
    - With dev server already running in another terminal:
      - npx playwright test path/to/spec.spec.ts -g "name substring"
    - One-off start server + run one spec:
      - npx start-server-and-test "vite" http://localhost:3000 "playwright test path/to/spec.spec.ts -g 'name substring'"

Environment
- Build-time environment variables (Vite reads these at build time)
  - VITE_API_URL: API base URL (preferred). If absent, code falls back to VITE_API_BASE_URL or "/api".
  - VITE_API_BASE_URL: Alternate API base (optional).
  - VITE_STRIPE_PUBLISHABLE_KEY: Stripe publishable key for checkout.
  - VITE_SNAPSHOTS: Set to "true" to enable automatic UI snapshots for debugging.
- Auth and dev behavior
  - In development (import.meta.env.DEV), route protection is bypassed and mock credentials are seeded in localStorage (token, refreshToken, credits, role=admin, name). This makes protected routes accessible without a backend.
  - In non-dev builds, routes require a valid token in localStorage; axios attaches it and will attempt a refresh on 401.

High-level architecture
- App shell and providers (src/App.tsx)
  - Wraps the app with QueryClientProvider (react-query), ThemeProvider (dark/light/system using localStorage key ui-theme), TooltipProvider, and two toaster components for notifications.
  - Router: BrowserRouter with a mix of public routes (login, register, etc.) and protected routes wrapped in ProtectedRoute. In dev, ProtectedRoute always allows access and seeds mock auth data.
  - SnapshotProvider (useAutoSnapshots) runs inside the router context to capture route-change and interaction screenshots when VITE_SNAPSHOTS=true.
- Data layer
  - Axios instance (src/lib/axios.ts)
    - baseURL comes from VITE_API_URL or VITE_API_BASE_URL, else "/api".
    - Request interceptor injects Authorization: Bearer <token> from localStorage when present.
    - Response interceptor handles 401 by calling /auth/refresh-token with the refreshToken; on success it retries the original request, on failure it clears storage and redirects to /login.
  - React Query (@tanstack/react-query) provides caching and refetching, e.g., summaries list polling.
- Summary creation and lifecycle
  - Upload flow: The SummaryForm component posts multipart/form-data to `${VITE_API_URL}/api/upload` with fields summaryName, deponent, and file. On success it receives a jobId and navigates to /summaries with UI state indicating processing.
  - Summaries page (src/pages/Summaries.tsx): Fetches from /api/summaries using the configured axios client, shows high-level stats, and splits items into processing, active (last 3 days), and inactive (older) lists. It polls periodically and will highlight the most recent job when navigated from the upload flow.
  - Viewing/downloading: SummaryDetail fetches a specific summary via `${VITE_API_URL}/api/summaries/view?id=...` with Authorization header.
- Payments
  - Checkout (src/pages/Checkout.tsx) computes tiered per-token pricing and optional Texas sales tax, then requests a client secret from `${VITE_API_URL}/api/purchase/purchase-credits`.
  - StripeCheckoutForm mounts Stripe Elements and confirms the PaymentIntent. On success it POSTs `${VITE_API_URL}/api/purchase/complete` and navigates to the return location (often /summaries).
- Theming and UI
  - shadcn/ui primitives live under src/components/ui; Tailwind is configured in tailwind.config.ts with CSS variables and custom utilities (e.g., pattern-grid-white).
  - ThemeProvider (src/components/providers/ThemeProvider.tsx) manages dark/light/system and persists to localStorage.
- Routing/layout
  - Most authenticated pages are wrapped by AuthenticatedLayout, which provides a fixed Sidebar and Footer and sets up mobile behavior.
  - The main marketing/home experience composes Sidebar + MainContent + Footer (src/pages/Index.tsx).
- Tooling and conventions
  - Path alias: "@" -> src (see vite.config.ts and tsconfig.json). Import as, e.g., import api from "@/lib/axios".
  - ESLint: configured via eslint.config.js with TypeScript and React Hooks rules; run via npm run lint.
  - Vite dev server is bound to all interfaces and uses port 3000.
  - The lovable-tagger plugin is enabled only in development to assist with component tagging.

Docker and deployment
- The Dockerfile performs a multi-stage build:
  1) Builder (node:20-bullseye): npm install, npm run build (VITE_API_URL can be injected via --build-arg)
  2) Runtime (nginx:stable-alpine): serves /app/dist from /usr/share/nginx/html
- The included nginx.conf handles SPA routing via try_files $uri /index.html and denies access to dotfiles.
- Example:
  - docker build -t loveable-web --build-arg VITE_API_URL="https://api.example.com" .
  - docker run -p 8080:80 loveable-web

Key quirks to be aware of
- In dev builds, authentication is bypassed by design (see ProtectedRoute). For realistic auth flows, test a production-mode build or unset the dev override logic.
- Axios defaults to "/api" if no VITE_API_URL/VITE_API_BASE_URL is provided; ensure your reverse proxy routes /api/* to the backend in production, or set an explicit base URL.
- The test script that runs headed mode (npm run test:ui:headful) does not start the dev server; start npm run dev first or use the one-off command shown above.


# Staging Deployment (GKE)

This document describes the current staging environment for Testifi AI and provides reproducible commands to build, deploy, verify, and roll back. It reflects the setup as of the latest staging rollout.

## TL;DR

- Platform: Google Kubernetes Engine (GKE)
- Cluster: `testifi` (zone `us-central1-c`)
- Namespace: `staging`
- Ingress: NGINX Ingress, host `staging.app.testifi.ai` → public IP `35.239.168.250`
- Frontend: Vite app (project `p-782854`) built into an Nginx image
- Backend: API service exposed at `/api/*`
- Container registry for staging: Google Container Registry (GCR) so GKE can pull without an imagePullSecret
- Stripe: publishable key injected at frontend build time; secret key and webhook secret stored in a Kubernetes Secret consumed by the backend
- Legacy staging VM (docker-compose + Caddy) has been stopped; staging is served exclusively by GKE

---

## Architecture

- DNS: `staging.app.testifi.ai` resolves to `35.239.168.250` (a regional forwarding rule fronting the GKE NGINX Ingress).
- Ingress (namespace `staging`):
  - Host: `staging.app.testifi.ai`
  - TLS: `cert-manager` `ClusterIssuer` (Let’s Encrypt)
  - Routes:
    - `/api` → Service `backend:80` → Pod container port `4000`
    - `/` (everything else) → Service `frontend:80` → Pod container port `80`
- Services:
  - `frontend` (ClusterIP): port `80` → container port `80`
  - `backend` (ClusterIP): port `80` → container port `4000`
- Deployments (namespace `staging`):
  - `frontend`: Nginx serving the Vite build (from `p-782854`)
  - `backend`: API server listening on `4000`

---

## Container images

- Registry used for staging: `gcr.io/<PROJECT_ID>`
  - Frontend example image/tag: `gcr.io/golden-cosmos-450417-i8/testifi-frontend:staging-YYYYMMDD-HHMMSS`
  - Backend example image/tag: `gcr.io/golden-cosmos-450417-i8/testifi-backend:staging-YYYYMMDD-HHMMSS`
- Why GCR instead of GHCR for staging: avoids `ImagePullBackOff` by not requiring a Kubernetes imagePullSecret. If you prefer GHCR, add an imagePullSecret to the `staging` namespace (see “Use GHCR instead of GCR”).

---

## Frontend (p-782854)

- Build-time variables consumed by Vite:
  - `VITE_API_URL` (typically `https://staging.app.testifi.ai`)
  - `VITE_STRIPE_PUBLISHABLE_KEY` (Stripe publishable key)
- Important: the Dockerfile removes any local `.env*` before build so CI/CLI provided build args are authoritative.
- Nginx config shipped in the image sets cache-control headers to prevent stale `index.html` caching.

### Build and push (Cloud Build)

```bash
# From repo root
PROJECT_ID=golden-cosmos-450417-i8
TAG=staging-$(date +%Y%m%d-%H%M%S)

gcloud builds submit p-782854 \
  --tag gcr.io/${PROJECT_ID}/testifi-frontend:${TAG} \
  --substitutions=_VITE_API_URL=https://staging.app.testifi.ai,_VITE_STRIPE_PUBLISHABLE_KEY=<your_publishable_key>
```

### Rollout to staging

```bash
# Get cluster creds once per shell
gcloud container clusters get-credentials testifi --zone us-central1-c

kubectl -n staging set image deploy/frontend \
  frontend=gcr.io/${PROJECT_ID}/testifi-frontend:${TAG}

kubectl -n staging rollout status deploy/frontend --timeout=180s
```

### Verify

```bash
HTML=$(curl -s https://staging.app.testifi.ai -H "Cache-Control: no-cache, no-store")
ASSET=$(printf "%s" "$HTML" | grep -o 'assets/[^"\']\+\.js' | head -n1)
echo "Asset: $ASSET"
curl -s "https://staging.app.testifi.ai/$ASSET" -H "Cache-Control: no-cache, no-store" | \
  grep -o 'pk_[A-Za-z0-9_-]\+' | head -n1
```

---

## Backend

- Deployment consumes Stripe secrets from a Kubernetes Secret named `backend-secrets` in the `staging` namespace.
- Keys expected in `backend-secrets`:
  - `STRIPE_API_KEY` (Stripe secret key, test for staging)
  - `STRIPE_WEBHOOK_SECRET` (signing secret for the configured endpoint)

### Update backend image

```bash
PROJECT_ID=golden-cosmos-450417-i8
BTAG=staging-$(date +%Y%m%d-%H%M%S)

gcloud builds submit backend --tag gcr.io/${PROJECT_ID}/testifi-backend:${BTAG}

kubectl -n staging set image deploy/backend \
  backend=gcr.io/${PROJECT_ID}/testifi-backend:${BTAG}

kubectl -n staging rollout status deploy/backend --timeout=180s
```

### Update secrets (idempotent)

```bash
# Replace placeholders with your real test secrets
kubectl -n staging create secret generic backend-secrets \
  --from-literal=STRIPE_API_KEY=sk_test_************************ \
  --from-literal=STRIPE_WEBHOOK_SECRET=whsec_********************* \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart backend to pick up changes if required
kubectl -n staging rollout restart deploy/backend
kubectl -n staging rollout status deploy/backend --timeout=180s
```

### Health

```bash
curl -sS https://staging.app.testifi.ai/api/health
```

---

## Use GHCR instead of GCR (optional)

```bash
# Create a pull secret in the staging namespace
kubectl -n staging create secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username=<GH_USERNAME> \
  --docker-password=<GH_PAT>

# Make the default ServiceAccount use it for pulls
kubectl -n staging patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"ghcr-creds"}]}'

# Then you can deploy images like:
kubectl -n staging set image deploy/frontend frontend=ghcr.io/<org>/p-782854:staging-latest
```

---

## Operational checks

```bash
# What images are running?
kubectl -n staging get deploy frontend backend -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{range .spec.template.spec.containers[*]}{.image}{"\n"}{end}{end}'

# Ingress details
kubectl -n staging get ingress testifi-ingress -o wide
kubectl -n staging describe ingress testifi-ingress | sed -n '1,200p'

# Pods and logs
kubectl -n staging get pods -o wide
kubectl -n staging logs deploy/frontend --tail=200
kubectl -n staging logs deploy/backend --tail=200
```

---

## Rollback

```bash
# Roll back to previous ReplicaSet
kubectl -n staging rollout undo deploy/frontend
kubectl -n staging rollout undo deploy/backend

# Or set image back to a known-good tag and roll forward
kubectl -n staging set image deploy/frontend frontend=gcr.io/${PROJECT_ID}/testifi-frontend:<KNOWN_GOOD_TAG>
kubectl -n staging set image deploy/backend  backend=gcr.io/${PROJECT_ID}/testifi-backend:<KNOWN_GOOD_TAG>
```

---

## Troubleshooting

- Stale frontend key or bundle in browser:
  - Hard refresh with devtools “Disable cache,” or use an Incognito window.
  - The image’s Nginx sets `no-store` on `/` and `/index.html`, but client caches may still retain old shells.
- `ImagePullBackOff` on frontend when using GHCR:
  - Add an `imagePullSecret` (see “Use GHCR instead of GCR”).
- TLS/Ingress issues:
  - Check `kubectl -n staging describe ingress testifi-ingress` for cert-manager events and NGINX warnings.
- Backend 401 with Stripe:
  - Ensure the frontend publishable key (build arg) and backend secret key (K8s secret) belong to the same Stripe account and mode (test for staging).

---

## Legacy staging VM (not in use)

- Instance `testifi-staging-vm` (zone `us-central1-c`, public IP `34.46.121.65`) previously ran docker-compose with `caddy`, `frontend`, and `backend`.
- That VM has been stopped; staging is served only through the GKE ingress at `35.239.168.250`.

---

## Branch and CI recommendations

- Treat `main` as production source-of-truth; deploy to staging from `main` with environment-specific targets.
- Alternatively, if keeping a `staging` branch, sync it with `main` regularly to avoid drift, then let CI build/push and roll the `staging` namespace.
- CI suggestions:
  - Frontend: build with `VITE_*` args; push to `gcr.io`; `kubectl set-image` for `deploy/frontend`.
  - Backend: build; push to `gcr.io`; `kubectl set-image` for `deploy/backend`.
  - Keep secrets in K8s; do not commit `.env` files.

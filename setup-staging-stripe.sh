#!/usr/bin/env bash
set -euo pipefail

# Updates STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET in the staging backend
# Usage:
#   TEST_STRIPE_API_KEY=sk_test_xxx TEST_STRIPE_WEBHOOK_SECRET=whsec_xxx ./setup-staging-stripe.sh

SECRET_NAME=${SECRET_NAME:-backend-secrets}

if [[ -z "${TEST_STRIPE_API_KEY:-}" || -z "${TEST_STRIPE_WEBHOOK_SECRET:-}" ]]; then
  echo "Usage: TEST_STRIPE_API_KEY=sk_test_xxx TEST_STRIPE_WEBHOOK_SECRET=whsec_xxx $0" >&2
  exit 1
fi

echo "Updating staging Stripe secrets in Kubernetes..."

kubectl patch secret "$SECRET_NAME" --type='json' \
  -p='[{"op":"replace","path":"/data/STRIPE_API_KEY","value":"'$(printf %s "$TEST_STRIPE_API_KEY" | base64)'"}]'

kubectl patch secret "$SECRET_NAME" --type='json' \
  -p='[{"op":"replace","path":"/data/STRIPE_WEBHOOK_SECRET","value":"'$(printf %s "$TEST_STRIPE_WEBHOOK_SECRET" | base64)'"}]'

echo "✅ Secrets updated. Restarting backend-staging deployment..."
kubectl rollout restart deployment backend-staging
echo "Done."





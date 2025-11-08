#!/usr/bin/env bash
set -euo pipefail

# Deploy latest built backend image to Kubernetes
# Usage:
#   PROJECT=golden-cosmos-450417-i8 NAMESPACE=default ./scripts/deploy_backend.sh [TAG]
# If TAG is omitted, uses the most recent Cloud Build ID as the tag.

PROJECT=${PROJECT:-golden-cosmos-450417-i8}
NAMESPACE=${NAMESPACE:-default}

if [[ $# -gt 0 ]]; then
  BUILD_ID="$1"
else
  echo "Fetching latest Cloud Build ID from project=$PROJECT..."
  BUILD_ID=$(gcloud builds list --project "$PROJECT" --sort-by=~createTime --format='value(id)' --limit=1)
fi

if [[ -z "${BUILD_ID:-}" ]]; then
  echo "Error: Could not determine build/tag to deploy" >&2
  exit 1
fi

IMAGE="gcr.io/$PROJECT/testifi-backend:$BUILD_ID"
echo "Updating backend to $IMAGE in namespace $NAMESPACE..."
kubectl -n "$NAMESPACE" set image deployment/backend backend="$IMAGE"

echo "Waiting for rollout..."
kubectl -n "$NAMESPACE" rollout status deployment/backend

echo "Done. backend now at $IMAGE"


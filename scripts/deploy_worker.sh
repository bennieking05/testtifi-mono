#!/usr/bin/env bash
set -euo pipefail

# Deploy latest built summarize-worker image to Kubernetes
# Usage:
#   PROJECT=golden-cosmos-450417-i8 NAMESPACE=default ./scripts/deploy_worker.sh
# Optional env vars:
#   PROJECT (default: golden-cosmos-450417-i8)
#   NAMESPACE (default: default)

PROJECT=${PROJECT:-golden-cosmos-450417-i8}
NAMESPACE=${NAMESPACE:-default}

echo "Building images on Cloud Build (project=$PROJECT)..."
gcloud builds submit backend --config backend/backend-cloudbuild.yaml --project "$PROJECT"

echo "Fetching latest Cloud Build ID..."
BUILD_ID=$(gcloud builds list --project "$PROJECT" --sort-by=~createTime --format='value(id)' --limit=1)
if [[ -z "$BUILD_ID" ]]; then
  echo "Error: Could not determine BUILD_ID" >&2
  exit 1
fi

IMAGE="gcr.io/$PROJECT/summarize-worker:$BUILD_ID"
echo "Updating summarize-worker to $IMAGE in namespace $NAMESPACE..."
kubectl -n "$NAMESPACE" set image deployment/summarize-worker summarize-worker="$IMAGE"

echo "Waiting for rollout..."
kubectl -n "$NAMESPACE" rollout status deployment/summarize-worker

echo "Done. summarize-worker now at $IMAGE"


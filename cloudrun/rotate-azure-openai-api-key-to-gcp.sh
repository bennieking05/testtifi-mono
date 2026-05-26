#!/usr/bin/env bash
# Push Azure OpenAI key1 from the "testifi" account into GCP Secret Manager (prod + staging).
# Requires: az login, gcloud auth with secretmanager.versions.add on project golden-cosmos-450417-i8
set -euo pipefail

RESOURCE="${AZURE_OPENAI_RESOURCE_NAME:-testifi}"
RG="${AZURE_OPENAI_RESOURCE_GROUP:-depo-summary}"
PROJ="${GCP_PROJECT:-golden-cosmos-450417-i8}"

KEY="$(az cognitiveservices account keys list --name "$RESOURCE" --resource-group "$RG" --query key1 -o tsv)"
if [[ -z "${KEY:-}" ]]; then
  echo "Failed to read Azure key1 for $RESOURCE in $RG" >&2
  exit 1
fi

printf %s "$KEY" | gcloud secrets versions add backend-secrets-AZURE_OPENAI_API_KEY --data-file=- --project="$PROJ"
printf %s "$KEY" | gcloud secrets versions add backend-secrets-staging-AZURE_OPENAI_API_KEY --data-file=- --project="$PROJ"

echo "Added new secret versions. Latest:"
gcloud secrets versions list backend-secrets-AZURE_OPENAI_API_KEY --project="$PROJ" --limit=2
gcloud secrets versions list backend-secrets-staging-AZURE_OPENAI_API_KEY --project="$PROJ" --limit=2
echo "Redeploy Cloud Run services (or bump an env var) so instances pick up :latest."

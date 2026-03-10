#!/bin/bash
# Refresh staging database with production data (Cloud SQL export/import via GCS).
# Run from repo root or cloudrun/. Requires gcloud and a GCS bucket in the project.
# Required permissions: Cloud SQL Admin (or export/import), Storage Object Admin on the bucket.
# Usage: ./refresh-staging-db-from-prod.sh   (or GCS_BUCKET=gs://my-bucket ./refresh-staging-db-from-prod.sh)
set -e

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
INSTANCE="testifi"
PRODUCTION_DB="deposition_ai"
STAGING_DB="deposition_ai_staging"
# Default bucket; override with env: GCS_BUCKET=gs://my-bucket ./refresh-staging-db-from-prod.sh
GCS_BUCKET="${GCS_BUCKET:-gs://${PROJECT_ID}_cloudbuild}"
DUMP_FILE="staging-refresh-prod-$(date +%Y%m%d-%H%M%S).sql"
GCS_URI="${GCS_BUCKET}/${DUMP_FILE}"

echo "Refresh staging DB from prod"
echo "  Instance: ${PROJECT_ID}:${REGION}:${INSTANCE}"
echo "  Prod DB:  ${PRODUCTION_DB}"
echo "  Staging:  ${STAGING_DB}"
echo "  GCS:      ${GCS_URI}"
echo ""

# 1. Export production database to GCS
echo "Step 1: Exporting production database to GCS..."
gcloud sql export sql "${INSTANCE}" "${GCS_URI}" \
  --database="${PRODUCTION_DB}" \
  --project="${PROJECT_ID}"

echo "  Export complete. File: ${GCS_URI}"

# 2. Ensure staging database exists (drop and recreate so we get a clean copy)
echo ""
echo "Step 2: Preparing staging database..."
if gcloud sql databases describe "${STAGING_DB}" --instance="${INSTANCE}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "  Dropping existing staging database ${STAGING_DB}..."
  gcloud sql databases delete "${STAGING_DB}" --instance="${INSTANCE}" --project="${PROJECT_ID}" --quiet
fi
echo "  Creating empty staging database ${STAGING_DB}..."
gcloud sql databases create "${STAGING_DB}" --instance="${INSTANCE}" --project="${PROJECT_ID}"

# 3. Rewrite dump so USE/DB references point to staging (Cloud SQL import uses USE from file if present)
echo ""
echo "Step 3: Preparing dump for staging database name..."
TMP_DUMP=$(mktemp)
CLEAN_URI="${GCS_BUCKET}/staging-refresh-clean-$(date +%Y%m%d-%H%M%S).sql"
gcloud storage cat "${GCS_URI}" --project="${PROJECT_ID}" | \
  sed -e "s/USE \`${PRODUCTION_DB}\`/USE \`${STAGING_DB}\`/g" \
      -e "s/USE ${PRODUCTION_DB}/USE ${STAGING_DB}/g" \
  > "${TMP_DUMP}"
gcloud storage cp "${TMP_DUMP}" "${CLEAN_URI}" --project="${PROJECT_ID}"
rm -f "${TMP_DUMP}"

echo "Step 4: Importing into ${STAGING_DB}..."
gcloud sql import sql "${INSTANCE}" "${CLEAN_URI}" \
  --database="${STAGING_DB}" \
  --project="${PROJECT_ID}" \
  --quiet

echo ""
echo "Step 5: Cleaning up GCS dump files..."
gcloud storage rm "${GCS_URI}" --project="${PROJECT_ID}" 2>/dev/null || true
gcloud storage rm "${CLEAN_URI}" --project="${PROJECT_ID}" 2>/dev/null || true

echo ""
echo "Done. Staging database ${STAGING_DB} now has a copy of production data."
echo "  - Staging backend and worker use DATABASE_URL from backend-secrets-staging-DATABASE_URL_CLOUDRUN."
echo "  - If schema differs, run Prisma migrations against staging: DATABASE_URL=<staging_url> npx prisma migrate deploy"
echo "  - Redeploy or restart staging backend/worker to pick up the refreshed data."

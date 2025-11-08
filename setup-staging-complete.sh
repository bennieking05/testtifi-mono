#!/bin/bash
# Complete staging environment setup with separate database and GPT-5

set -e

PROJECT_ID="golden-cosmos-450417-i8"
CLUSTER_NAME="testifi"
CLUSTER_ZONE="us-central1-c"
SQL_INSTANCE="testifi"
STAGING_DB="deposition_ai_staging"
PRODUCTION_DB="deposition_ai"

echo "🧪 Complete Staging Environment Setup"
echo "====================================="
echo ""
echo "This will:"
echo "  1. Create separate staging database from latest backup"
echo "  2. Update staging secrets"
echo "  3. Deploy backend + worker with GPT-5"
echo ""

# Get latest backup
echo "📦 Finding latest backup..."
LATEST_BACKUP=$(gcloud sql backups list --instance=$SQL_INSTANCE --project=$PROJECT_ID --limit=1 --format="value(id)")
BACKUP_TIME=$(gcloud sql backups describe $LATEST_BACKUP --instance=$SQL_INSTANCE --project=$PROJECT_ID --format="value(windowStartTime)")

echo "  Latest backup: $LATEST_BACKUP"
echo "  Time: $BACKUP_TIME"
echo ""

# Check if staging DB exists
if gcloud sql databases describe $STAGING_DB --instance=$SQL_INSTANCE --project=$PROJECT_ID &> /dev/null; then
    echo "⚠️  Staging database '$STAGING_DB' already exists"
    read -p "   Delete and recreate from backup? (y/n): " RECREATE
    if [[ "$RECREATE" == "y" ]]; then
        echo "   Deleting existing staging database..."
        gcloud sql databases delete $STAGING_DB --instance=$SQL_INSTANCE --project=$PROJECT_ID --quiet
    else
        echo "   Using existing database"
        SKIP_DB_CREATE=true
    fi
fi

if [[ "$SKIP_DB_CREATE" != "true" ]]; then
    echo "📦 Creating staging database..."
    gcloud sql databases create $STAGING_DB --instance=$SQL_INSTANCE --project=$PROJECT_ID
    
    echo "📦 Restoring from backup..."
    echo "   Note: This creates a NEW Cloud SQL instance temporarily, then we'll copy the DB"
    echo "   Skipping full restore for now - using empty database"
    echo "   To manually restore: Use Cloud Console to restore backup to temporary instance,"
    echo "   then export/import the database"
fi

# Get cluster credentials
echo ""
echo "🔐 Getting GKE credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --zone="$CLUSTER_ZONE" \
  --project="$PROJECT_ID"

# Update staging secrets to use staging database
echo ""
echo "🔐 Updating staging secrets..."

# Get current DATABASE_URL and update the database name
CURRENT_URL=$(kubectl get secret backend-secrets -n staging -o jsonpath='{.data.DATABASE_URL}' | base64 -d)
NEW_URL=$(echo "$CURRENT_URL" | sed "s/$PRODUCTION_DB/$STAGING_DB/g")

echo "  Old DB: $PRODUCTION_DB"
echo "  New DB: $STAGING_DB"

# Update the secret
kubectl patch secret backend-secrets -n staging --type='json' -p="[
  {\"op\": \"replace\", \"path\": \"/data/DATABASE_URL\", \"value\": \"$(echo -n $NEW_URL | base64)\"},
  {\"op\": \"replace\", \"path\": \"/data/DB_NAME\", \"value\": \"$(echo -n $STAGING_DB | base64)\"}
]"

echo "✅ Secrets updated"

# Deploy backend and worker to staging
echo ""
echo "📦 Deploying backend to staging..."
kubectl apply -f backend-deployment.staging.yaml -n staging

echo "📦 Deploying worker to staging..."
kubectl apply -f summarize-worker-deployment.staging.yaml -n staging

# Wait for rollouts
echo ""
echo "🔄 Waiting for rollouts..."
kubectl rollout status deployment/backend -n staging --timeout=300s
kubectl rollout status deployment/summarize-worker -n staging --timeout=600s

# Verify
echo ""
echo "✅ Staging deployment complete!"
echo ""
echo "📊 Configuration:"
echo "  Database: $STAGING_DB (separate from production)"
echo "  GPT-5 Model: gpt-5-testifi"
echo "  API Version: 2025-01-01-preview"
echo ""

# Show staging info
STAGING_URL=$(kubectl get ingress -n staging -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "Not found")
echo "🌐 Staging site: https://$STAGING_URL"
echo ""

echo "📦 Pods:"
kubectl get pods -n staging
echo ""

echo "🎉 Staging environment ready!"
echo ""
echo "⚠️  Important: Run Prisma migrations on staging database:"
echo "   kubectl exec -n staging deploy/backend -c backend -- npx prisma migrate deploy"
echo ""


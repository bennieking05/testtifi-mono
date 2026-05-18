#!/bin/bash
# Deploy the summarize worker as a Cloud Run service (always-on)
# This is simpler than Cloud Run Jobs for a polling worker
set -e

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
CLOUD_SQL_INSTANCE="golden-cosmos-450417-i8:us-central1:testifi"

echo "🚀 Deploying Summarize Worker to Cloud Run..."

# Ensure we're using the correct project
gcloud config set project $PROJECT_ID

SA_EMAIL="testifi-cloudrun@${PROJECT_ID}.iam.gserviceaccount.com"

# Build and push worker image
echo "🔨 Building worker image..."
cd ../backend
gcloud builds submit \
    --config=backend-build-worker.yaml .

cd ../cloudrun

# Deploy Worker (Production) - with min-instances=1 to keep it running
echo "🚀 Deploying summarize-worker..."
gcloud run deploy testifi-summarize-worker \
    --image gcr.io/$PROJECT_ID/summarize-worker:latest \
    --region $REGION \
    --platform managed \
    --add-cloudsql-instances $CLOUD_SQL_INSTANCE \
    --service-account $SA_EMAIL \
    --no-allow-unauthenticated \
    --min-instances 1 \
    --max-instances 1 \
    --memory 2Gi \
    --cpu 2 \
    --timeout 3600 \
    --set-env-vars "NODE_ENV=production,WORKER_CONCURRENCY=1,PAGE_RANGE_SIZE=5,AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-testifi,AZURE_API_VERSION=2025-01-01-preview,BASE_URL=https://app.testifi.ai" \
    --set-secrets "DATABASE_URL=backend-secrets-DATABASE_URL_CLOUDRUN:latest,SENDGRID_API_KEY=backend-secrets-SENDGRID_API_KEY:latest,AZURE_OPENAI_API_KEY=backend-secrets-AZURE_OPENAI_API_KEY:latest,AZURE_OPENAI_ENDPOINT=backend-secrets-AZURE_OPENAI_ENDPOINT:latest"

echo ""
echo "✅ Worker deployment complete!"
echo ""
echo "⚠️  Note: The worker runs with min-instances=1, which costs ~\$25/month."
echo "   This is required for the polling-based worker architecture."
echo ""
echo "💡 Alternative: Convert to event-driven with Cloud Tasks/Pub-Sub for \$0 idle cost."

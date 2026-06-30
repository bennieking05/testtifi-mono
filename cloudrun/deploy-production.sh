#!/bin/bash
# Deploy TestifiAI to Cloud Run (Production Environment)
set -e
cd "$(dirname "$0")"

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
CLOUD_SQL_INSTANCE="golden-cosmos-450417-i8:us-central1:testifi"

echo "🚀 Deploying TestifiAI Production to Cloud Run..."

# Ensure we're using the correct project
gcloud config set project $PROJECT_ID

# Create service account for Cloud Run (if not exists)
SA_NAME="testifi-cloudrun"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe $SA_EMAIL &>/dev/null; then
    echo "🔑 Creating service account..."
    gcloud iam service-accounts create $SA_NAME \
        --display-name="TestifiAI Cloud Run Service Account"
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/cloudsql.client"
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/storage.objectAdmin"
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SA_EMAIL}" \
        --role="roles/secretmanager.secretAccessor"
fi

# Build and push backend image (production)
echo "🔨 Building backend image..."
cd ../backend
gcloud builds submit \
    --config=backend-build-cloudrun.yaml \
    --substitutions=_IMAGE_TAG=latest .

# Build and push frontend image (production)
echo "🔨 Building frontend image..."
cd ../loveable
gcloud builds submit \
    --config=frontend-cloudbuild-cloudrun.yaml \
    --substitutions=_IMAGE_TAG=latest,_VITE_API_URL=https://app.testifi.ai .

cd ../cloudrun

# Deploy Backend (Production)
echo "🚀 Deploying backend..."
gcloud run deploy testifi-backend \
    --image gcr.io/$PROJECT_ID/testifi-backend:latest \
    --region $REGION \
    --platform managed \
    --add-cloudsql-instances $CLOUD_SQL_INSTANCE \
    --service-account $SA_EMAIL \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 3 \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --set-env-vars "NODE_ENV=production,BASE_URL=https://app.testifi.ai,BACKEND_URL=https://app.testifi.ai,AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.4-testifi,AZURE_API_VERSION=2025-01-01-preview" \
    --set-secrets "DATABASE_URL=backend-secrets-DATABASE_URL_CLOUDRUN:latest,SENDGRID_API_KEY=backend-secrets-SENDGRID_API_KEY:latest,JWT_SECRET=backend-secrets-JWT_SECRET:latest,STRIPE_API_KEY=backend-secrets-STRIPE_API_KEY:latest,STRIPE_WEBHOOK_SECRET=backend-secrets-STRIPE_WEBHOOK_SECRET:latest,AZURE_OPENAI_API_KEY=backend-secrets-AZURE_OPENAI_API_KEY:latest,AZURE_OPENAI_ENDPOINT=backend-secrets-AZURE_OPENAI_ENDPOINT:latest"

# Deploy Frontend (Production)
echo "🚀 Deploying frontend..."
gcloud run deploy testifi-frontend \
    --image gcr.io/$PROJECT_ID/testifi-frontend:latest \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 2 \
    --memory 256Mi \
    --cpu 1

# Get the service URLs
BACKEND_URL=$(gcloud run services describe testifi-backend --region $REGION --format 'value(status.url)')
FRONTEND_URL=$(gcloud run services describe testifi-frontend --region $REGION --format 'value(status.url)')

echo ""
echo "✅ Production deployment complete! (backend + frontend)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Backend URL:  $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""
echo "⚠️  This script does NOT deploy the summarize worker."
echo "   If your change touches the summary pipeline (backend/src/worker/**),"
echo "   you MUST also run:  ./deploy-worker.sh"
echo "   Otherwise the prod worker keeps running the OLD image."
echo "   (The cloudrun-deploy.yml GitHub workflow deploys all three automatically.)"
echo ""
echo "📝 Next steps:"
echo "   1. Map custom domain: gcloud run domain-mappings create --service testifi-frontend --domain app.testifi.ai --region $REGION"
echo "   2. Update DNS records to point to Cloud Run"

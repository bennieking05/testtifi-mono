#!/bin/bash
# Deploy TestifiAI to Cloud Run (Staging Environment)
set -e

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
CLOUD_SQL_INSTANCE="golden-cosmos-450417-i8:us-central1:testifi"

echo "🚀 Deploying TestifiAI Staging to Cloud Run..."

# Ensure we're using the correct project
gcloud config set project $PROJECT_ID

# Enable required APIs (if not already enabled)
echo "📦 Enabling required APIs..."
gcloud services enable run.googleapis.com secretmanager.googleapis.com sqladmin.googleapis.com --quiet

# Create service account for Cloud Run (if not exists)
SA_NAME="testifi-cloudrun"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if ! gcloud iam service-accounts describe $SA_EMAIL &>/dev/null; then
    echo "🔑 Creating service account..."
    gcloud iam service-accounts create $SA_NAME \
        --display-name="TestifiAI Cloud Run Service Account"
    
    # Grant necessary permissions
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

# Build and push backend image (staging)
echo "🔨 Building backend image..."
cd ../backend
gcloud builds submit \
    --config=backend-build-cloudrun.yaml \
    --substitutions=_IMAGE_TAG=staging .

# Build and push worker image (staging)
echo "🔨 Building worker image..."
gcloud builds submit \
    --config=backend-build-worker-staging.yaml .

# Build and push frontend image (staging)
echo "🔨 Building frontend image..."
cd ../loveable
gcloud builds submit \
    --config=frontend-cloudbuild-cloudrun.yaml \
    --substitutions=_IMAGE_TAG=staging,_VITE_API_URL=https://testifi-backend-staging-748916208557.us-central1.run.app,_VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51SPyHb1PKdcq2R5zdlTdxGxpj8Lc6AFNbeBfGNkJ5QmMC6IOOE8osz3KqQ3a04RCUsbSPhl694U5p35JAmOuYT0w00PXMi588j .

cd ../cloudrun

# Deploy Backend (Staging)
echo "🚀 Deploying backend-staging..."
gcloud run deploy testifi-backend-staging \
    --image gcr.io/$PROJECT_ID/testifi-backend:staging \
    --region $REGION \
    --platform managed \
    --add-cloudsql-instances $CLOUD_SQL_INSTANCE \
    --service-account $SA_EMAIL \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 2 \
    --memory 512Mi \
    --cpu 1 \
    --timeout 300 \
    --set-env-vars "NODE_ENV=staging,BASE_URL=https://staging.app.testifi.ai,BACKEND_URL=https://staging.app.testifi.ai,AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.5-testifi,AZURE_API_VERSION=2025-01-01-preview,EMAIL_USER=admin@testifi.ai" \
    --set-secrets "DATABASE_URL=backend-secrets-staging-DATABASE_URL_CLOUDRUN:latest,SENDGRID_API_KEY=backend-secrets-staging-SENDGRID_API_KEY:latest,JWT_SECRET=backend-secrets-staging-JWT_SECRET:latest,STRIPE_API_KEY=backend-secrets-staging-STRIPE_API_KEY:latest,STRIPE_WEBHOOK_SECRET=backend-secrets-staging-STRIPE_WEBHOOK_SECRET:latest,AZURE_OPENAI_API_KEY=backend-secrets-staging-AZURE_OPENAI_API_KEY:latest,AZURE_OPENAI_ENDPOINT=backend-secrets-staging-AZURE_OPENAI_ENDPOINT:latest"

# Deploy Summarize Worker (Staging)
echo "🚀 Deploying summarize-worker-staging..."
gcloud run deploy testifi-summarize-worker-staging \
    --image gcr.io/$PROJECT_ID/summarize-worker:staging \
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
    --no-cpu-throttling \
    --set-env-vars "NODE_ENV=staging,BASE_URL=https://staging.app.testifi.ai,WORKER_CONCURRENCY=1,PAGE_RANGE_SIZE=5,AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5.5-testifi,AZURE_API_VERSION=2025-01-01-preview,EMAIL_USER=admin@testifi.ai" \
    --set-secrets "DATABASE_URL=backend-secrets-staging-DATABASE_URL_CLOUDRUN:latest,SENDGRID_API_KEY=backend-secrets-staging-SENDGRID_API_KEY:latest,AZURE_OPENAI_API_KEY=backend-secrets-staging-AZURE_OPENAI_API_KEY:latest,AZURE_OPENAI_ENDPOINT=backend-secrets-staging-AZURE_OPENAI_ENDPOINT:latest"

# Deploy Frontend (Staging)
echo "🚀 Deploying frontend-staging..."
gcloud run deploy testifi-frontend-staging \
    --image gcr.io/$PROJECT_ID/testifi-frontend:staging \
    --region $REGION \
    --platform managed \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 2 \
    --memory 256Mi \
    --cpu 1

# Get the service URLs
BACKEND_URL=$(gcloud run services describe testifi-backend-staging --region $REGION --format 'value(status.url)')
FRONTEND_URL=$(gcloud run services describe testifi-frontend-staging --region $REGION --format 'value(status.url)')

echo ""
echo "✅ Staging deployment complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Backend URL:  $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
echo ""
echo "📝 Next steps:"
echo "   1. Test the staging environment"
echo "   2. Map custom domain: gcloud run domain-mappings create --service testifi-frontend-staging --domain staging.app.testifi.ai --region $REGION"

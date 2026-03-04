#!/bin/bash
# Setup secrets in Google Secret Manager for Cloud Run
# Run this ONCE before deploying to Cloud Run
set -e

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
CLOUD_SQL_INSTANCE="testifi"

echo "🔐 Setting up secrets for Cloud Run..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com --quiet

# Function to create or update a secret
create_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if gcloud secrets describe $secret_name --project=$PROJECT_ID &>/dev/null; then
        echo "  Updating existing secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets versions add $secret_name --data-file=-
    else
        echo "  Creating new secret: $secret_name"
        echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=- --replication-policy="automatic"
    fi
}

echo ""
echo "📋 You'll need to provide the following secrets."
echo "   Leave blank to skip (use existing values)."
echo ""

# Production secrets
echo "═══════════════════════════════════════════════════"
echo "PRODUCTION SECRETS"
echo "═══════════════════════════════════════════════════"

# DATABASE_URL for Cloud Run (uses Unix socket)
# Format: mysql://USER:PASSWORD@localhost/DATABASE?socket=/cloudsql/PROJECT:REGION:INSTANCE
echo ""
echo "Database URL for Cloud Run (uses Unix socket path):"
echo "Format: mysql://USER:PASSWORD@localhost/DATABASE?socket=/cloudsql/${PROJECT_ID}:${REGION}:${CLOUD_SQL_INSTANCE}"
read -p "DATABASE_URL_CLOUDRUN (production): " DB_URL_PROD
if [ -n "$DB_URL_PROD" ]; then
    create_secret "backend-secrets_DATABASE_URL_CLOUDRUN" "$DB_URL_PROD"
fi

read -p "SENDGRID_API_KEY (production): " SENDGRID_PROD
if [ -n "$SENDGRID_PROD" ]; then
    create_secret "backend-secrets_SENDGRID_API_KEY" "$SENDGRID_PROD"
fi

read -p "JWT_SECRET (production): " JWT_PROD
if [ -n "$JWT_PROD" ]; then
    create_secret "backend-secrets_JWT_SECRET" "$JWT_PROD"
fi

read -p "STRIPE_API_KEY (production): " STRIPE_KEY_PROD
if [ -n "$STRIPE_KEY_PROD" ]; then
    create_secret "backend-secrets_STRIPE_API_KEY" "$STRIPE_KEY_PROD"
fi

read -p "STRIPE_WEBHOOK_SECRET (production): " STRIPE_WEBHOOK_PROD
if [ -n "$STRIPE_WEBHOOK_PROD" ]; then
    create_secret "backend-secrets_STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_PROD"
fi

read -p "AZURE_OPENAI_API_KEY (production): " AZURE_KEY_PROD
if [ -n "$AZURE_KEY_PROD" ]; then
    create_secret "backend-secrets_AZURE_OPENAI_API_KEY" "$AZURE_KEY_PROD"
fi

read -p "AZURE_OPENAI_ENDPOINT (production): " AZURE_ENDPOINT_PROD
if [ -n "$AZURE_ENDPOINT_PROD" ]; then
    create_secret "backend-secrets_AZURE_OPENAI_ENDPOINT" "$AZURE_ENDPOINT_PROD"
fi

# Staging secrets
echo ""
echo "═══════════════════════════════════════════════════"
echo "STAGING SECRETS"
echo "═══════════════════════════════════════════════════"

read -p "DATABASE_URL_CLOUDRUN (staging): " DB_URL_STAGING
if [ -n "$DB_URL_STAGING" ]; then
    create_secret "backend-secrets-staging_DATABASE_URL_CLOUDRUN" "$DB_URL_STAGING"
fi

read -p "SENDGRID_API_KEY (staging, or same as prod): " SENDGRID_STAGING
if [ -n "$SENDGRID_STAGING" ]; then
    create_secret "backend-secrets-staging_SENDGRID_API_KEY" "$SENDGRID_STAGING"
fi

read -p "JWT_SECRET (staging): " JWT_STAGING
if [ -n "$JWT_STAGING" ]; then
    create_secret "backend-secrets-staging_JWT_SECRET" "$JWT_STAGING"
fi

read -p "STRIPE_API_KEY (staging - TEST key): " STRIPE_KEY_STAGING
if [ -n "$STRIPE_KEY_STAGING" ]; then
    create_secret "backend-secrets-staging_STRIPE_API_KEY" "$STRIPE_KEY_STAGING"
fi

read -p "STRIPE_WEBHOOK_SECRET (staging): " STRIPE_WEBHOOK_STAGING
if [ -n "$STRIPE_WEBHOOK_STAGING" ]; then
    create_secret "backend-secrets-staging_STRIPE_WEBHOOK_SECRET" "$STRIPE_WEBHOOK_STAGING"
fi

read -p "AZURE_OPENAI_API_KEY (staging): " AZURE_KEY_STAGING
if [ -n "$AZURE_KEY_STAGING" ]; then
    create_secret "backend-secrets-staging_AZURE_OPENAI_API_KEY" "$AZURE_KEY_STAGING"
fi

read -p "AZURE_OPENAI_ENDPOINT (staging): " AZURE_ENDPOINT_STAGING
if [ -n "$AZURE_ENDPOINT_STAGING" ]; then
    create_secret "backend-secrets-staging_AZURE_OPENAI_ENDPOINT" "$AZURE_ENDPOINT_STAGING"
fi

echo ""
echo "✅ Secrets setup complete!"
echo ""
echo "📝 To verify secrets, run:"
echo "   gcloud secrets list --project=$PROJECT_ID"

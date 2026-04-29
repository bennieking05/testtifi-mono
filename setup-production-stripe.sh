#!/bin/bash

# Production Stripe Setup Script for Testifi AI
# This script helps set up production Stripe keys and webhooks

PROJECT_ID="golden-cosmos-450417-i8"
REGION="us-central1"
BACKEND_SERVICE="testifi-backend"
WEBHOOK_URL="https://app.testifi.ai/api/purchase/stripe-webhook"

echo "🔐 Production Stripe Setup for Testifi AI"
echo "Project: $PROJECT_ID"
echo ""

# Check if stripe CLI is logged in
if ! stripe config --list | grep -q "live_mode_api_key"; then
    echo "❌ Stripe CLI not configured for live mode"
    echo "Please run: stripe login"
    exit 1
fi

echo "✅ Stripe CLI is configured"
echo ""

# Get live API key (this will be masked, user needs to provide it)
echo "📋 Current Stripe Configuration:"
echo "Live API Key: $(stripe config --list | grep 'live_mode_api_key' | cut -d"'" -f2 | cut -c1-20)..."
echo "Live Pub Key: $(stripe config --list | grep 'live_mode_pub_key' | cut -d"'" -f2 | cut -c1-20)..."
echo ""

echo "🔧 Production Stripe Setup Steps:"
echo ""
echo "1. Get your live Stripe API key from Stripe Dashboard"
echo "2. Set up production webhook endpoint"
echo "3. Update Secret Manager secrets"
echo "4. Restart Cloud Run backend"
echo "5. Test production payments"
echo ""

echo "📋 Step 1: Get Live Stripe Keys"
echo "Go to: https://dashboard.stripe.com/apikeys"
echo "Copy your 'Secret key' (starts with sk_live_)"
echo ""

read -p "Enter your live Stripe API key (sk_live_...): " live_api_key

if [[ ! $live_api_key == sk_live_* ]]; then
    echo "❌ Invalid API key format. Should start with 'sk_live_'"
    exit 1
fi

echo ""
echo "📋 Step 2: Set up Production Webhook"
echo "Setting up webhook endpoint: $WEBHOOK_URL"
echo ""

# Create webhook endpoint
echo "Creating webhook endpoint..."
WEBHOOK_ID=$(stripe webhook_endpoints create \
  --url="$WEBHOOK_URL" \
  --enabled-events="payment_intent.succeeded,checkout.session.completed,charge.refund.created,charge.dispute.created" \
  --api-key="$live_api_key" \
  --format="json" | jq -r '.id')

if [ "$WEBHOOK_ID" != "null" ] && [ ! -z "$WEBHOOK_ID" ]; then
    echo "✅ Webhook created: $WEBHOOK_ID"
    
    # Get webhook secret
    WEBHOOK_SECRET=$(stripe webhook_endpoints retrieve $WEBHOOK_ID --api-key="$live_api_key" --format="json" | jq -r '.secret')
    
    if [ "$WEBHOOK_SECRET" != "null" ] && [ ! -z "$WEBHOOK_SECRET" ]; then
        echo "✅ Webhook secret: $WEBHOOK_SECRET"
    else
        echo "❌ Failed to get webhook secret"
        exit 1
    fi
else
    echo "❌ Failed to create webhook"
    exit 1
fi

echo ""
echo "📋 Step 3: Update Secret Manager Secrets"
echo "Updating production secrets..."

# Update Stripe API key
printf "%s" "$live_api_key" | gcloud secrets versions add backend-secrets-STRIPE_API_KEY \
  --project="$PROJECT_ID" \
  --data-file=-

# Update Stripe webhook secret
printf "%s" "$WEBHOOK_SECRET" | gcloud secrets versions add backend-secrets-STRIPE_WEBHOOK_SECRET \
  --project="$PROJECT_ID" \
  --data-file=-

echo "✅ Secret Manager secrets updated"

echo ""
echo "📋 Step 4: Restart Cloud Run Backend"
echo "Restarting backend service..."

gcloud run services update "$BACKEND_SERVICE" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --update-env-vars="STRIPE_CONFIG_REFRESH=$(date +%s)"

echo "✅ Backend service restarted"

echo ""
echo "📋 Step 5: Verify Deployment"
echo "Checking deployment status..."

kubectl rollout status deployment/backend --timeout=300s
kubectl rollout status deployment/summarize-worker --timeout=300s

echo ""
echo "🎉 Production Stripe Setup Complete!"
echo ""
echo "📊 Summary:"
echo "✅ Live API Key: Updated"
echo "✅ Webhook Secret: Updated"
echo "✅ Webhook Endpoint: $WEBHOOK_URL"
echo "✅ Backend: Restarted"
echo ""
echo "🧪 Next Steps:"
echo "1. Test a small payment in production"
echo "2. Check Stripe Dashboard for transactions"
echo "3. Monitor application logs"
echo ""
echo "📊 Monitor Commands:"
echo "gcloud run services describe $BACKEND_SERVICE --project=$PROJECT_ID --region=$REGION"
echo "gcloud logging read 'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$BACKEND_SERVICE\" AND textPayload:(\"stripe\" OR \"payment\" OR \"webhook\")' --project=$PROJECT_ID --limit=50"
echo "stripe events list --limit=10"
echo ""
echo "⚠️  Important:"
echo "- Test with small amounts first"
echo "- Monitor logs for any errors"
echo "- Keep test keys for staging environment"

#!/bin/bash

# Production Stripe Setup Script for Testifi AI
# This script helps set up production Stripe keys and webhooks

PROJECT_ID="golden-cosmos-450417-i8"
SECRET_NAME="backend-secrets"

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
echo "3. Update Kubernetes secrets"
echo "4. Test production payments"
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
echo "Setting up webhook endpoint: https://app.testifi.ai/api/purchase/webhook"
echo ""

# Create webhook endpoint
echo "Creating webhook endpoint..."
WEBHOOK_ID=$(stripe webhook_endpoints create \
  --url="https://app.testifi.ai/api/purchase/webhook" \
  --enabled-events="payment_intent.succeeded,payment_intent.payment_failed,checkout.session.completed" \
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
echo "📋 Step 3: Update Kubernetes Secrets"
echo "Updating production secrets..."

# Update Stripe API key
kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_API_KEY", "value": "'$(echo -n "$live_api_key" | base64)'"}]'

# Update Stripe webhook secret
kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_WEBHOOK_SECRET", "value": "'$(echo -n "$webhook_secret" | base64)'"}]'

echo "✅ Kubernetes secrets updated"

echo ""
echo "📋 Step 4: Restart Deployments"
echo "Restarting backend and worker deployments..."

kubectl rollout restart deployment/backend
kubectl rollout restart deployment/summarize-worker

echo "✅ Deployments restarted"

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
echo "✅ Webhook Endpoint: https://app.testifi.ai/api/purchase/webhook"
echo "✅ Deployments: Restarted"
echo ""
echo "🧪 Next Steps:"
echo "1. Test a small payment in production"
echo "2. Check Stripe Dashboard for transactions"
echo "3. Monitor application logs"
echo ""
echo "📊 Monitor Commands:"
echo "kubectl get pods"
echo "kubectl logs -l app=backend"
echo "stripe events list --limit=10"
echo ""
echo "⚠️  Important:"
echo "- Test with small amounts first"
echo "- Monitor logs for any errors"
echo "- Keep test keys for staging environment"

#!/bin/bash

# Production Secrets Update Script for Testifi AI
# This script helps update Kubernetes secrets for production

PROJECT_ID="golden-cosmos-450417-i8"
SECRET_NAME="backend-secrets"

echo "🔐 Production Secrets Update Script"
echo "Project: $PROJECT_ID"
echo "Secret: $SECRET_NAME"
echo ""

# Check if kubectl is configured
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ kubectl not configured. Please run:"
    echo "   gcloud container clusters get-credentials testifi --zone us-central1-c --project $PROJECT_ID"
    exit 1
fi

echo "📋 Current Stripe Configuration:"
echo "Current STRIPE_API_KEY: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d | cut -c1-20)..."
echo ""

echo "🔧 Production Secrets Update Options:"
echo ""
echo "1. Update Stripe API Key (CRITICAL for production)"
echo "2. Update Stripe Webhook Secret"
echo "3. Update Base URLs for production"
echo "4. View current secrets"
echo "5. Exit"
echo ""

read -p "Select option (1-5): " choice

case $choice in
    1)
        echo ""
        echo "🔑 Update Stripe API Key"
        echo "Current: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d | cut -c1-20)..."
        echo ""
        echo "⚠️  WARNING: This will update to LIVE Stripe keys!"
        echo "Make sure you have your production Stripe keys ready."
        echo ""
        read -p "Enter new Stripe API Key (sk_live_...): " new_stripe_key
        
        if [[ $new_stripe_key == sk_live_* ]]; then
            echo "Updating Stripe API Key..."
            kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_API_KEY", "value": "'$(echo -n "$new_stripe_key" | base64)'"}]'
            echo "✅ Stripe API Key updated"
        else
            echo "❌ Invalid Stripe key format. Should start with 'sk_live_'"
        fi
        ;;
    2)
        echo ""
        echo "🔑 Update Stripe Webhook Secret"
        echo "Current: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d | cut -c1-20)..."
        echo ""
        read -p "Enter new Stripe Webhook Secret (whsec_...): " new_webhook_secret
        
        if [[ $new_webhook_secret == whsec_* ]]; then
            echo "Updating Stripe Webhook Secret..."
            kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_WEBHOOK_SECRET", "value": "'$(echo -n "$new_webhook_secret" | base64)'"}]'
            echo "✅ Stripe Webhook Secret updated"
        else
            echo "❌ Invalid webhook secret format. Should start with 'whsec_'"
        fi
        ;;
    3)
        echo ""
        echo "🔑 Update Base URLs for Production"
        echo "Current BASE_URL: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.BASE_URL}' | base64 -d)"
        echo "Current BACKEND_URL: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.BACKEND_URL}' | base64 -d)"
        echo ""
        read -p "Enter new BASE_URL (https://app.testifi.ai): " new_base_url
        read -p "Enter new BACKEND_URL (https://app.testifi.ai): " new_backend_url
        
        echo "Updating URLs..."
        kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/BASE_URL", "value": "'$(echo -n "$new_base_url" | base64)'"}]'
        kubectl patch secret $SECRET_NAME --type='json' -p='[{"op": "replace", "path": "/data/BACKEND_URL", "value": "'$(echo -n "$new_backend_url" | base64)'"}]'
        echo "✅ URLs updated"
        ;;
    4)
        echo ""
        echo "📋 Current Secrets:"
        echo "STRIPE_API_KEY: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d | cut -c1-20)..."
        echo "STRIPE_WEBHOOK_SECRET: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d | cut -c1-20)..."
        echo "BASE_URL: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.BASE_URL}' | base64 -d)"
        echo "BACKEND_URL: $(kubectl get secret $SECRET_NAME -o jsonpath='{.data.BACKEND_URL}' | base64 -d)"
        ;;
    5)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "❌ Invalid option"
        ;;
esac

echo ""
echo "🔄 Restarting deployments to apply changes..."
kubectl rollout restart deployment/backend
kubectl rollout restart deployment/summarize-worker

echo ""
echo "📊 Checking deployment status..."
kubectl rollout status deployment/backend --timeout=300s
kubectl rollout status deployment/summarize-worker --timeout=300s

echo ""
echo "✅ Production secrets update complete!"
echo ""
echo "🎯 Next steps:"
echo "1. Verify Stripe keys are working in production"
echo "2. Test payment processing"
echo "3. Monitor logs for any issues"
echo ""
echo "📊 Monitor deployments:"
echo "kubectl get pods"
echo "kubectl logs -l app=backend"

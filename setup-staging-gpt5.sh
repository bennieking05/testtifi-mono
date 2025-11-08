#!/bin/bash
# Deploy GPT-5 configuration to staging environment

set -e

PROJECT_ID="golden-cosmos-450417-i8"
CLUSTER_NAME="testifi"
CLUSTER_ZONE="us-central1-c"
NAMESPACE="staging"

echo "🧪 Setting Up Staging Environment with GPT-5"
echo "=============================================="
echo ""

# Get cluster credentials
echo "🔐 Getting GKE credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --zone="$CLUSTER_ZONE" \
  --project="$PROJECT_ID"

echo ""
echo "📋 Current staging deployments:"
kubectl get deployments -n $NAMESPACE
echo ""

# Check if worker exists
if kubectl get deployment summarize-worker -n $NAMESPACE &> /dev/null; then
    echo "✅ Worker deployment exists"
    HAS_WORKER=true
else
    echo "⚠️  Worker deployment not found - will create it"
    HAS_WORKER=false
fi

echo ""
read -p "Continue with staging GPT-5 deployment? (y/n): " CONFIRM
if [[ "$CONFIRM" != "y" ]]; then
    echo "❌ Aborted"
    exit 0
fi

# Apply backend deployment
echo ""
echo "📦 Applying backend deployment to staging..."
kubectl apply -f backend-deployment.staging.yaml -n $NAMESPACE

# Apply or create worker deployment
if [ "$HAS_WORKER" = true ]; then
    echo "📦 Updating worker deployment in staging..."
    kubectl apply -f summarize-worker-deployment.staging.yaml -n $NAMESPACE
else
    echo "📦 Creating worker deployment in staging..."
    kubectl apply -f summarize-worker-deployment.staging.yaml -n $NAMESPACE
fi

# Wait for rollouts
echo ""
echo "🔄 Waiting for deployments to roll out..."
kubectl rollout status deployment/backend -n $NAMESPACE --timeout=300s
kubectl rollout status deployment/summarize-worker -n $NAMESPACE --timeout=600s

# Verify GPT-5 config
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Verifying GPT-5 configuration:"
BACKEND_MODEL=$(kubectl get deployment backend -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[*].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}' 2>/dev/null || echo "N/A")
WORKER_MODEL=$(kubectl get deployment summarize-worker -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[*].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}' 2>/dev/null || echo "N/A")

echo "  Backend: $BACKEND_MODEL"
echo "  Worker: $WORKER_MODEL"
echo ""

# Show staging URL
echo "🌐 Staging site:"
STAGING_URL=$(kubectl get ingress -n $NAMESPACE -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "Not found")
echo "  https://$STAGING_URL"
echo ""

# Show pods
echo "📦 Current pods:"
kubectl get pods -n $NAMESPACE
echo ""

echo "🎉 Staging environment ready!"
echo ""
echo "🧪 Next steps:"
echo "  1. Visit https://$STAGING_URL"
echo "  2. Upload a test deposition"
echo "  3. Verify GPT-5 quality"
echo "  4. Compare with production"
echo ""


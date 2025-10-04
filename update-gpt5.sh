#!/bin/bash
# Update Azure OpenAI to use GPT-5

set -e

echo "🚀 Upgrading to GPT-5..."

# Configuration
PROJECT_ID="golden-cosmos-450417-i8"
CLUSTER_NAME="testifi"
CLUSTER_ZONE="us-central1-c"
NAMESPACE="default"

# GPT-5 deployment name from Azure (change this to match your deployment)
NEW_DEPLOYMENT_NAME="gpt5-chat"  # Or "gpt5-codex" if you named it that

# New API version (GPT-5 might need a newer version)
NEW_API_VERSION="2024-10-01-preview"  # Update if needed

echo "📋 Configuration:"
echo "  Deployment Name: $NEW_DEPLOYMENT_NAME"
echo "  API Version: $NEW_API_VERSION"
echo ""

# Get cluster credentials
echo "🔐 Getting GKE credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --zone="$CLUSTER_ZONE" \
  --project="$PROJECT_ID"

# Get current secret values (to preserve other secrets)
echo "📥 Fetching current secrets..."
CURRENT_ENDPOINT=$(kubectl get secret backend-secrets -n $NAMESPACE -o jsonpath='{.data.AZURE_OPENAI_ENDPOINT}' | base64 -d)
CURRENT_API_KEY=$(kubectl get secret backend-secrets -n $NAMESPACE -o jsonpath='{.data.AZURE_OPENAI_API_KEY}' | base64 -d)

echo "  Current Endpoint: $CURRENT_ENDPOINT"
echo ""

# Update the secret with new deployment name and API version
echo "🔄 Updating Kubernetes secret..."
kubectl patch secret backend-secrets -n $NAMESPACE --type='json' -p="[
  {\"op\": \"replace\", \"path\": \"/data/AZURE_OPENAI_DEPLOYMENT_NAME\", \"value\": \"$(echo -n $NEW_DEPLOYMENT_NAME | base64)\"},
  {\"op\": \"replace\", \"path\": \"/data/AZURE_API_VERSION\", \"value\": \"$(echo -n $NEW_API_VERSION | base64)\"}
]"

echo "✅ Secret updated!"
echo ""

# Restart deployments to pick up new config
echo "🔄 Restarting backend deployment..."
kubectl rollout restart deployment/backend -n $NAMESPACE

echo "🔄 Restarting summarize-worker deployment..."
kubectl rollout restart deployment/summarize-worker -n $NAMESPACE

echo ""
echo "⏳ Waiting for rollouts to complete..."
kubectl rollout status deployment/backend -n $NAMESPACE --timeout=300s
kubectl rollout status deployment/summarize-worker -n $NAMESPACE --timeout=300s

echo ""
echo "🎉 Successfully upgraded to GPT-5!"
echo ""
echo "📊 Verify the deployment:"
echo "  kubectl logs -l app=summarize-worker -n $NAMESPACE --tail=50"
echo ""
echo "🧪 Test by uploading a deposition and checking the quality!"


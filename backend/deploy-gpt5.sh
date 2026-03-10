#!/bin/bash
# Deploy GPT-5 configuration to production and staging

set -e

PROJECT_ID="golden-cosmos-450417-i8"
CLUSTER_NAME="testifi"
CLUSTER_ZONE="us-central1-c"
NAMESPACE="default"

echo "🚀 Deploying GPT-5 Configuration"
echo "================================"
echo ""

# Get cluster credentials
echo "🔐 Getting GKE credentials..."
gcloud container clusters get-credentials "$CLUSTER_NAME" \
  --zone="$CLUSTER_ZONE" \
  --project="$PROJECT_ID"

echo ""
echo "📋 Choose deployment environment:"
echo "  1) Production (GPT-5)"
echo "  2) Staging (GPT-4o)"
echo "  3) Both"
echo ""
read -p "Enter choice (1-3): " CHOICE

deploy_production() {
  echo ""
  echo "🚀 Deploying PRODUCTION configuration (GPT-5)..."
  echo ""
  
  echo "📦 Applying backend deployment..."
  kubectl apply -f backend-deployment.yaml -n $NAMESPACE
  
  echo "📦 Applying worker deployment..."
  kubectl apply -f summarize-worker-deployment.yaml -n $NAMESPACE
  
  echo "🔄 Waiting for rollouts to complete..."
  kubectl rollout status deployment/backend -n $NAMESPACE --timeout=300s
  kubectl rollout status deployment/summarize-worker -n $NAMESPACE --timeout=600s
  
  echo "✅ Production deployment complete!"
  echo ""
  echo "📊 Current configuration:"
  kubectl get deployment backend -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
  echo " (Backend)"
  kubectl get deployment summarize-worker -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[1].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
  echo " (Worker)"
  echo ""
}

deploy_staging() {
  echo ""
  echo "🧪 Deploying STAGING configuration (GPT-4o)..."
  echo ""
  
  echo "📦 Applying backend deployment..."
  kubectl apply -f backend-deployment.staging.yaml -n $NAMESPACE
  
  echo "📦 Applying worker deployment..."
  kubectl apply -f summarize-worker-deployment.staging.yaml -n $NAMESPACE
  
  echo "🔄 Waiting for rollouts to complete..."
  kubectl rollout status deployment/backend -n $NAMESPACE --timeout=300s
  kubectl rollout status deployment/summarize-worker -n $NAMESPACE --timeout=600s
  
  echo "✅ Staging deployment complete!"
  echo ""
  echo "📊 Current configuration:"
  kubectl get deployment backend -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
  echo " (Backend)"
  kubectl get deployment summarize-worker -n $NAMESPACE -o jsonpath='{.spec.template.spec.containers[1].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
  echo " (Worker)"
  echo ""
}

case $CHOICE in
  1)
    deploy_production
    ;;
  2)
    deploy_staging
    ;;
  3)
    deploy_production
    echo ""
    echo "======================================"
    echo ""
    deploy_staging
    ;;
  *)
    echo "❌ Invalid choice"
    exit 1
    ;;
esac

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "🧪 Test by uploading a deposition:"
echo "   - Production will use GPT-5 (best quality)"
echo "   - Staging will use GPT-4o (stable baseline)"
echo ""
echo "📊 Monitor logs:"
echo "   kubectl logs -l app=summarize-worker -n $NAMESPACE --tail=50"
echo ""


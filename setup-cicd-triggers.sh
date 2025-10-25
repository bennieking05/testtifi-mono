#!/bin/bash

# CI/CD Setup Script for Testifi AI
# This script sets up Cloud Build triggers for main and staging branches

PROJECT_ID="golden-cosmos-450417-i8"
REPO_OWNER="bennieking05"
REPO_NAME="testifi-backend"

echo "🚀 Setting up CI/CD triggers for Testifi AI"
echo "Project: $PROJECT_ID"
echo "Repository: $REPO_OWNER/$REPO_NAME"
echo ""

# Check if gcloud is authenticated
echo "📋 Checking authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not authenticated. Please run: gcloud auth login"
    exit 1
fi

# Check if project is set
echo "📋 Checking project..."
if ! gcloud config get-value project | grep -q "$PROJECT_ID"; then
    echo "📋 Setting project to $PROJECT_ID"
    gcloud config set project $PROJECT_ID
fi

# Enable required APIs
echo "📋 Enabling required APIs..."
gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
gcloud services enable containerregistry.googleapis.com --project=$PROJECT_ID
gcloud services enable container.googleapis.com --project=$PROJECT_ID

# Check if GitHub App is connected
echo "📋 Checking GitHub App connection..."
if ! gcloud builds triggers list --project=$PROJECT_ID --filter="github.owner:$REPO_OWNER" --format="value(name)" | grep -q .; then
    echo "❌ GitHub App not connected. Please connect via Cloud Console:"
    echo "   https://console.cloud.google.com/cloud-build/triggers?project=$PROJECT_ID"
    echo "   1. Click 'Create Trigger'"
    echo "   2. Select 'GitHub (App)'"
    echo "   3. Connect repository: $REPO_OWNER/$REPO_NAME"
    echo "   4. Then run this script again"
    exit 1
fi

echo "✅ GitHub App is connected"
echo ""

# Create main branch trigger
echo "📋 Creating main branch trigger..."
if gcloud builds triggers create github \
  --repo-name=$REPO_NAME \
  --repo-owner=$REPO_OWNER \
  --branch-pattern="^main$" \
  --build-config=backend/backend-cloudbuild.yaml \
  --project=$PROJECT_ID \
  --name="testifi-backend-main" \
  --description="Build and deploy backend to production from main branch"; then
    echo "✅ Main branch trigger created"
else
    echo "❌ Failed to create main branch trigger"
fi

# Create staging branch trigger
echo "📋 Creating staging branch trigger..."
if gcloud builds triggers create github \
  --repo-name=$REPO_NAME \
  --repo-owner=$REPO_OWNER \
  --branch-pattern="^staging$" \
  --build-config=backend/backend-cloudbuild.yaml \
  --project=$PROJECT_ID \
  --name="testifi-backend-staging" \
  --description="Build and deploy backend to staging from staging branch"; then
    echo "✅ Staging branch trigger created"
else
    echo "❌ Failed to create staging branch trigger"
fi

# Create frontend triggers
echo "📋 Creating frontend triggers..."

# Frontend main trigger
if gcloud builds triggers create github \
  --repo-name=$REPO_NAME \
  --repo-owner=$REPO_OWNER \
  --branch-pattern="^main$" \
  --build-config=loveable/frontend-cloudbuild.yaml \
  --project=$PROJECT_ID \
  --name="testifi-frontend-main" \
  --description="Build and deploy frontend to production from main branch"; then
    echo "✅ Frontend main trigger created"
else
    echo "❌ Failed to create frontend main trigger"
fi

# Frontend staging trigger
if gcloud builds triggers create github \
  --repo-name=$REPO_NAME \
  --repo-owner=$REPO_OWNER \
  --branch-pattern="^staging$" \
  --build-config=loveable/frontend-cloudbuild.yaml \
  --project=$PROJECT_ID \
  --name="testifi-frontend-staging" \
  --description="Build and deploy frontend to staging from staging branch"; then
    echo "✅ Frontend staging trigger created"
else
    echo "❌ Failed to create frontend staging trigger"
fi

echo ""
echo "📊 Listing all triggers:"
gcloud builds triggers list --project=$PROJECT_ID --format="table(name,github.push.branch,status)"

echo ""
echo "🎯 Next steps:"
echo "1. Test production: git push origin main"
echo "2. Test staging: git push origin staging"
echo "3. Monitor builds: gcloud builds list --project=$PROJECT_ID"
echo ""
echo "✅ CI/CD setup complete!"

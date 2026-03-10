# CI/CD Setup Guide for Testifi AI

## 🚀 Complete CI/CD Pipeline Setup

This guide will help you set up a complete CI/CD pipeline that automatically builds and deploys your application when you push to GitHub.

## 📋 Prerequisites

1. **GitHub Repository**: You need a GitHub repository for your code
2. **GCP Project**: `golden-cosmos-450417-i8` (already configured)
3. **GKE Cluster**: `testifi` in `us-central1-c` (already configured)
4. **Cloud Build API**: Enabled (we'll check this)

## 🔧 Step 1: Set Up GitHub Repository

### Option A: Create New Repository
```bash
# Create a new repository on GitHub first, then:
cd /Users/bennieking/Sites/testifiAi
git remote add origin https://github.com/YOUR_USERNAME/testifi-ai.git
git push -u origin main
git push origin staging
```

### Option B: Use Existing Repository
```bash
# If you already have a GitHub repository:
cd /Users/bennieking/Sites/testifiAi
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
git push origin staging
```

## 🔧 Step 2: Enable Required APIs

```bash
# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com --project=golden-cosmos-450417-i8

# Enable Container Registry API
gcloud services enable containerregistry.googleapis.com --project=golden-cosmos-450417-i8

# Enable GKE API
gcloud services enable container.googleapis.com --project=golden-cosmos-450417-i8
```

## 🔧 Step 3: Create Cloud Build Triggers

### Backend Trigger (Main Branch)
```bash
gcloud builds triggers create github \
  --repo-name=testifi-ai \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config=backend/backend-cloudbuild.yaml \
  --project=golden-cosmos-450417-i8 \
  --name="testifi-backend-main" \
  --description="Build and deploy backend from main branch"
```

### Frontend Trigger (Main Branch)
```bash
gcloud builds triggers create github \
  --repo-name=testifi-ai \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^main$" \
  --build-config=loveable/frontend-cloudbuild.yaml \
  --project=golden-cosmos-450417-i8 \
  --name="testifi-frontend-main" \
  --description="Build and deploy frontend from main branch"
```

### Staging Triggers
```bash
# Backend Staging
gcloud builds triggers create github \
  --repo-name=testifi-ai \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^staging$" \
  --build-config=backend/backend-cloudbuild.yaml \
  --project=golden-cosmos-450417-i8 \
  --name="testifi-backend-staging" \
  --description="Build and deploy backend from staging branch"

# Frontend Staging
gcloud builds triggers create github \
  --repo-name=testifi-ai \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --branch-pattern="^staging$" \
  --build-config=loveable/frontend-cloudbuild.yaml \
  --project=golden-cosmos-450417-i8 \
  --name="testifi-frontend-staging" \
  --description="Build and deploy frontend from staging branch"
```

## 🔧 Step 4: Configure Service Account Permissions

```bash
# Get the Cloud Build service account
PROJECT_NUMBER=$(gcloud projects describe golden-cosmos-450417-i8 --format="value(projectNumber)")
CLOUD_BUILD_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

# Grant necessary permissions
gcloud projects add-iam-policy-binding golden-cosmos-450417-i8 \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/container.developer"

gcloud projects add-iam-policy-binding golden-cosmos-450417-i8 \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding golden-cosmos-450417-i8 \
  --member="serviceAccount:${CLOUD_BUILD_SA}" \
  --role="roles/container.clusterViewer"
```

## 🔧 Step 5: Test the Pipeline

### Test Main Branch Deployment
```bash
# Make a small change and push to main
echo "# Test commit" >> README.md
git add README.md
git commit -m "test: trigger CI/CD pipeline"
git push origin main
```

### Test Staging Branch Deployment
```bash
# Switch to staging and make a change
git checkout staging
echo "# Staging test commit" >> README.md
git add README.md
git commit -m "test: trigger staging CI/CD pipeline"
git push origin staging
```

## 📊 Monitor Builds

### View Build History
```bash
gcloud builds list --project=golden-cosmos-450417-i8 --limit=10
```

### View Build Logs
```bash
# Get the latest build ID
BUILD_ID=$(gcloud builds list --project=golden-cosmos-450417-i8 --limit=1 --format="value(id)")

# View logs
gcloud builds log $BUILD_ID --project=golden-cosmos-450417-i8
```

## 🔧 Step 6: Update Staging Branches

To ensure your staging branches are up to date:

```bash
# Update staging branch with latest main
git checkout staging
git merge main
git push origin staging

# Or reset staging to match main exactly
git checkout staging
git reset --hard main
git push origin staging --force
```

## 🎯 Workflow Summary

1. **Development**: Work on feature branches
2. **Staging**: Merge to `staging` branch → Auto-deploy to staging environment
3. **Production**: Merge to `main` branch → Auto-deploy to production environment

## 🔍 Troubleshooting

### Check Trigger Status
```bash
gcloud builds triggers list --project=golden-cosmos-450417-i8
```

### Check Build Status
```bash
gcloud builds list --project=golden-cosmos-450417-i8 --filter="status=WORKING"
```

### View Build Details
```bash
gcloud builds describe BUILD_ID --project=golden-cosmos-450417-i8
```

## 📝 Next Steps

1. Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username
2. Create the GitHub repository
3. Run the setup commands
4. Test the pipeline with a small commit

## 🚨 Important Notes

- **GitHub Repository**: You need to create this first
- **Service Account**: Make sure Cloud Build has proper permissions
- **Branch Protection**: Consider setting up branch protection rules
- **Secrets**: Ensure all environment variables are properly configured in Kubernetes secrets

## 📞 Support

If you encounter issues:
1. Check the Cloud Build logs
2. Verify GitHub webhook configuration
3. Ensure all APIs are enabled
4. Check service account permissions

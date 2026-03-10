# 🚀 Cloud Build CI/CD Setup Guide

## Current Status
- ✅ **GitHub Repository**: Connected and pushed
- ✅ **Cloud Build Configs**: Ready (`backend-cloudbuild.yaml`, `frontend-cloudbuild.yaml`)
- ✅ **GCP Project**: `golden-cosmos-450417-i8`
- ❌ **GitHub Integration**: Needs to be set up
- ❌ **Cloud Build Triggers**: Pending GitHub integration

## 🔧 Step 1: Set Up GitHub App Integration

### Option A: Via Cloud Console (Recommended)
1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers?project=golden-cosmos-450417-i8)
2. Click **"Create Trigger"**
3. Select **"GitHub (App)"** as the source
4. Click **"Connect Repository"**
5. Authorize GitHub App access to your repository
6. Select repository: `bennieking05/testifi-backend`

### Option B: Via gcloud CLI
```bash
# First, you need to set up GitHub App integration
gcloud builds triggers create github \
  --repo-name=testifi-backend \
  --repo-owner=bennieking05 \
  --branch-pattern="^main$" \
  --build-config=backend/backend-cloudbuild.yaml \
  --project=golden-cosmos-450417-i8 \
  --name="testifi-backend-production"
```

## 🔧 Step 2: Create Production Triggers

### Backend Production Trigger
- **Name**: `testifi-backend-production`
- **Repository**: `bennieking05/testifi-backend`
- **Branch**: `main`
- **Build Config**: `backend/backend-cloudbuild.yaml`
- **Description**: "Build and deploy backend to production from main branch"

### Frontend Production Trigger
- **Name**: `testifi-frontend-production`
- **Repository**: `bennieking05/testifi-backend`
- **Branch**: `main`
- **Build Config**: `loveable/frontend-cloudbuild.yaml`
- **Description**: "Build and deploy frontend to production from main branch"

## 🔧 Step 3: Create Staging Triggers

### Backend Staging Trigger
- **Name**: `testifi-backend-staging`
- **Repository**: `bennieking05/testifi-backend`
- **Branch**: `staging`
- **Build Config**: `backend/backend-cloudbuild.yaml`
- **Description**: "Build and deploy backend to staging from staging branch"

### Frontend Staging Trigger
- **Name**: `testifi-frontend-staging`
- **Repository**: `bennieking05/testifi-backend`
- **Branch**: `staging`
- **Build Config**: `loveable/frontend-cloudbuild.yaml`
- **Description**: "Build and deploy frontend to staging from staging branch"

## 🔧 Step 4: Test the Pipeline

### Test Production Deployment
```bash
# Make a small change and push to main
echo "# Production test" >> README.md
git add README.md
git commit -m "test: trigger production CI/CD pipeline"
git push origin main
```

### Test Staging Deployment
```bash
# Switch to staging and make a change
git checkout staging
echo "# Staging test" >> README.md
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

## 🎯 Workflow Summary

### Development Workflow
1. **Feature Development**: Work on feature branches
2. **Staging**: Merge to `staging` branch → Auto-deploy to staging environment
3. **Production**: Merge to `main` branch → Auto-deploy to production environment

### Branch Strategy
- **`main`**: Production environment (auto-deploy)
- **`staging`**: Staging environment (auto-deploy)
- **Feature branches**: Development (manual testing)

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

## 🚨 Important Notes

### GitHub App Permissions
Make sure the GitHub App has access to:
- Repository: `bennieking05/testifi-backend`
- Permissions: Read repository, Read and write webhooks

### Service Account Permissions
Ensure Cloud Build service account has:
- `roles/container.developer`
- `roles/storage.admin`
- `roles/container.clusterViewer`

### Build Configuration
- **Backend**: Uses `backend/backend-cloudbuild.yaml`
- **Frontend**: Uses `loveable/frontend-cloudbuild.yaml`
- **Images**: Pushed to `gcr.io/golden-cosmos-450417-i8/`

## 📞 Next Steps

1. **Set up GitHub App integration** (via Cloud Console)
2. **Create the triggers** (using the Cloud Console or CLI)
3. **Test the pipeline** with a small commit
4. **Monitor builds** to ensure everything works

## 🔗 Useful Links

- [Cloud Build Triggers Console](https://console.cloud.google.com/cloud-build/triggers?project=golden-cosmos-450417-i8)
- [GitHub App Integration](https://console.cloud.google.com/cloud-build/triggers?project=golden-cosmos-450417-i8)
- [Build History](https://console.cloud.google.com/cloud-build/builds?project=golden-cosmos-450417-i8)

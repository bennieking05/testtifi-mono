# GPT-5 Deployment Configuration

## Overview

Your TestifiAI backend now supports **two separate deployment environments** with different AI models:

### **Production Environment** 🚀
- **Model:** GPT-5 (latest)
- **Deployment Name:** `gpt-5`
- **API Version:** `2024-10-01-preview`
- **Purpose:** Best quality summaries for production users
- **Files:**
  - `backend-deployment.yaml`
  - `summarize-worker-deployment.yaml`

### **Staging Environment** 🧪
- **Model:** GPT-5 (same as production for now)
- **Deployment Name:** `gpt-5`
- **API Version:** `2024-10-01-preview`
- **Purpose:** Testing before production deployment. Can be upgraded to GPT-6 or newer models first to test before moving production.
- **Files:**
  - `backend-deployment.staging.yaml`
  - `summarize-worker-deployment.staging.yaml`

---

## Prerequisites

### 1. Create Azure OpenAI Deployment

In Azure Portal, create ONE GPT-5 deployment (used by both prod and staging):

```
Azure OpenAI Studio → Deployments → + Create new deployment

Deployment:
  Model: gpt-5 or gpt-5-preview
  Deployment name: gpt-5
  TPM Rate Limit: 150K+ recommended
```

**Note:** Both production and staging will share the same GPT-5 deployment. In the future, you can create a second deployment (e.g., `gpt-6-preview`) for staging to test newer models before upgrading production.

### 2. Update Deployment Names (if different)

If your Azure deployment names differ, update these files:

**Production:**
```yaml
# backend-deployment.yaml (line 137)
# summarize-worker-deployment.yaml (line 110)
- name: AZURE_OPENAI_DEPLOYMENT_NAME
  value: "YOUR_GPT5_DEPLOYMENT_NAME"
```

**Staging:**
```yaml
# backend-deployment.staging.yaml (line 126)
# summarize-worker-deployment.staging.yaml (line 110)
- name: AZURE_OPENAI_DEPLOYMENT_NAME
  value: "YOUR_GPT4_DEPLOYMENT_NAME"
```

---

## Deployment

### Quick Deploy (Interactive)

```bash
cd /Users/bennieking/Sites/testifiAi/backend
./deploy-gpt5.sh

# Choose:
#   1) Production (GPT-5)
#   2) Staging (GPT-4o)  
#   3) Both
```

### Manual Deploy

#### Deploy Production:
```bash
kubectl apply -f backend-deployment.yaml -n default
kubectl apply -f summarize-worker-deployment.yaml -n default
kubectl rollout status deployment/backend -n default
kubectl rollout status deployment/summarize-worker -n default
```

#### Deploy Staging:
```bash
kubectl apply -f backend-deployment.staging.yaml -n default
kubectl apply -f summarize-worker-deployment.staging.yaml -n default
kubectl rollout status deployment/backend -n default
kubectl rollout status deployment/summarize-worker -n default
```

---

## Verification

### Check Current Model Configuration:

```bash
# Backend deployment
kubectl get deployment backend -n default -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'

# Worker deployment  
kubectl get deployment summarize-worker -n default -o jsonpath='{.spec.template.spec.containers[1].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
```

### Monitor Logs:

```bash
# Backend logs
kubectl logs -l app=backend -n default --tail=50 -f

# Worker logs (shows AI model calls)
kubectl logs -l app=summarize-worker -n default --tail=100 -f
```

### Test Upload:

1. Upload a test deposition
2. Check worker logs for model being used
3. Verify summary quality

---

## Cloud Build Integration

The Cloud Build process automatically deploys using the production configuration. If you push to `main`:

```bash
git add backend-deployment.yaml summarize-worker-deployment.yaml
git commit -m "feat: upgrade to GPT-5 for production summaries"
git push origin main
```

Cloud Build will:
1. Build new Docker images
2. Push to GCR
3. Deploy to GKE using `backend-deployment.yaml`
4. Apply Prisma migrations
5. Restart worker with new config

---

## GPT-5 Advantages

- ✅ More detailed summaries (longer context window)
- ✅ Better legal terminology understanding
- ✅ Improved metadata extraction
- ✅ More accurate page number detection
- ✅ Better handling of complex multi-party depositions
- ✅ Improved reasoning for complex testimony
- ✅ Better document reference extraction

## Future: Staging as Preview Environment

When GPT-6 or newer models are available, you can:
1. Create a second deployment (e.g., `gpt-6-preview`)
2. Update `backend-deployment.staging.yaml` to use it
3. Test thoroughly in staging
4. Once validated, upgrade production to GPT-6

---

## Cost Considerations

### Token Pricing (approximate):
- **GPT-5:** $0.03/1K input tokens, $0.06/1K output tokens (estimate, check Azure pricing)

### Per Deposition Estimate:
- **241 PDF pages (~964 transcript pages)**
- **~48 chunks × 4000 tokens = ~192K tokens**
  - Estimated cost: ~$8-10 per deposition

**Note:** Both production and staging use the same deployment, so costs are combined. Monitor Azure OpenAI usage to optimize.

---

## Rollback

If GPT-5 has issues, you can:

### Option 1: Create a fallback GPT-4o deployment
```bash
# Create GPT-4o deployment in Azure
az cognitiveservices account deployment create \
  --name YOUR_RESOURCE \
  --resource-group YOUR_RG \
  --deployment-name "gpt-4o-fallback" \
  --model-name "gpt-4o" \
  --model-version "2024-08-06" \
  --model-format OpenAI \
  --sku-capacity 100 \
  --sku-name "Standard"

# Update deployments to use fallback
kubectl set env deployment/backend AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-fallback -n default
kubectl set env deployment/summarize-worker AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-fallback -n default
```

### Option 2: Roll back to previous Docker image
```bash
# Get previous working image
kubectl rollout history deployment/backend -n default
kubectl rollout history deployment/summarize-worker -n default

# Rollback
kubectl rollout undo deployment/backend -n default
kubectl rollout undo deployment/summarize-worker -n default
```

---

## Troubleshooting

### Issue: "Deployment not found"
```bash
# Check Azure deployments
az cognitiveservices account deployment list \
  --name YOUR_RESOURCE_NAME \
  --resource-group YOUR_RG
```

### Issue: Rate limits (HTTP 429)
- Check Azure OpenAI quota
- Reduce `WORKER_CONCURRENCY` (currently set to 1)
- Increase retry delays in `summarizeWorker.ts`

### Issue: High costs
- Monitor token usage in Azure Portal
- Consider using GPT-4o for non-critical summaries
- Implement tiered pricing (GPT-5 for premium users only)

---

## Next Steps

1. ✅ Deploy GPT-5 to production
2. 🧪 Test with sample depositions
3. 📊 Monitor quality and costs
4. 🔍 Compare GPT-5 vs GPT-4o outputs
5. 💰 Adjust pricing based on model costs
6. 🎯 Consider tiered plans (Basic=GPT-4o, Premium=GPT-5)


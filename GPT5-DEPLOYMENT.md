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
- **Model:** GPT-4o (stable)
- **Deployment Name:** `gpt-4o`
- **API Version:** `2024-08-01-preview`
- **Purpose:** Reliability testing and baseline comparison
- **Files:**
  - `backend-deployment.staging.yaml`
  - `summarize-worker-deployment.staging.yaml`

---

## Prerequisites

### 1. Create Azure OpenAI Deployments

In Azure Portal, create TWO deployments:

```
Azure OpenAI Studio → Deployments → + Create new deployment

Deployment 1 (Production):
  Model: gpt-5 or gpt-5-preview
  Deployment name: gpt-5
  TPM Rate Limit: 150K+ recommended
  
Deployment 2 (Staging):
  Model: gpt-4o
  Deployment name: gpt-4o
  TPM Rate Limit: 100K+ recommended
```

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

## Model Comparison

### GPT-5 Advantages (Production):
- ✅ More detailed summaries (longer context window)
- ✅ Better legal terminology understanding
- ✅ Improved metadata extraction
- ✅ More accurate page number detection
- ✅ Better handling of complex multi-party depositions

### GPT-4o Advantages (Staging):
- ✅ Proven stable performance
- ✅ Lower latency
- ✅ More predictable token usage
- ✅ Good baseline for comparison testing

---

## Cost Considerations

### Token Pricing (approximate):
- **GPT-5:** $0.03/1K input tokens, $0.06/1K output tokens
- **GPT-4o:** $0.005/1K input tokens, $0.015/1K output tokens

### Per Deposition Estimate:
- **241 PDF pages (~964 transcript pages)**
- **~48 chunks × 4000 tokens = ~192K tokens**
  - GPT-5: ~$8-10 per deposition
  - GPT-4o: ~$1.50-2 per deposition

Use staging for testing, production for paying customers.

---

## Rollback

If GPT-5 has issues, quickly rollback to stable GPT-4o:

```bash
# Quick rollback - deploy staging config to production
kubectl apply -f backend-deployment.staging.yaml -n default
kubectl apply -f summarize-worker-deployment.staging.yaml -n default
kubectl rollout status deployment/backend -n default
kubectl rollout status deployment/summarize-worker -n default
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


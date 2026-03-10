# 🚀 Deploy GPT-5 - Quick Start Guide

## ✅ What's Ready

Your backend is configured to use GPT-5 for both production and staging:
- ✅ All deployment configs updated
- ✅ Worker configs updated
- ✅ Scripts created for Azure deployment
- ✅ Documentation complete
- ✅ Everything committed to git

---

## 🎯 Step 1: Create GPT-5 Deployment in Azure

### Option A: Use the Automated Script (Recommended)

```bash
cd /Users/bennieking/Sites/testifiAi/backend
./create-azure-deployments.sh
```

**What it does:**
- Prompts for your Azure OpenAI resource name and resource group
- Creates a single `gpt-5` deployment (150K TPM capacity)
- Both production and staging will use this deployment
- Updates YAML files if you use a different deployment name

### Option B: Manual Azure Portal Setup

1. Go to https://portal.azure.com
2. Navigate to your Azure OpenAI resource
3. Click **"Model deployments"**
4. Click **"+ Create new deployment"**
5. Configure:
   ```
   Model: gpt-5 (or gpt-5-preview)
   Deployment name: gpt-5
   Version: Latest available
   TPM Rate Limit: 150,000
   ```
6. Click **Create**

### Option C: Azure CLI Manual

```bash
RESOURCE_NAME="your-openai-resource"
RESOURCE_GROUP="your-resource-group"

az cognitiveservices account deployment create \
  --name "$RESOURCE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --deployment-name "gpt-5" \
  --model-name "gpt-5" \
  --model-version "latest" \
  --model-format OpenAI \
  --sku-capacity 150 \
  --sku-name "Standard"
```

---

## 🎯 Step 2: Verify Azure Deployment

```bash
# List deployments
az cognitiveservices account deployment list \
  --name YOUR_RESOURCE_NAME \
  --resource-group YOUR_RESOURCE_GROUP \
  --query "[].{Name:name,Model:properties.model.name,Status:properties.provisioningState}" \
  --output table

# Should show:
# Name    Model   Status
# ----    -----   ------
# gpt-5   gpt-5   Succeeded
```

---

## 🎯 Step 3: Push to Deploy

```bash
cd /Users/bennieking/Sites/testifiAi/backend

# Push commits to trigger Cloud Build
git push origin main
```

**What happens:**
1. Cloud Build triggers automatically
2. Builds Docker images with GPT-5 config
3. Deploys to GKE
4. Backend and worker restart with GPT-5
5. ~5-8 minutes total

---

## 🎯 Step 4: Monitor Deployment

### Watch Cloud Build:
```bash
gcloud builds list --project=golden-cosmos-450417-i8 --limit=1

# Or open in browser:
open https://console.cloud.google.com/cloud-build/builds?project=golden-cosmos-450417-i8
```

### Check Pod Status:
```bash
# Watch pods restart
kubectl get pods -n default -w

# Check backend logs
kubectl logs -l app=backend -n default --tail=50 -f

# Check worker logs (shows GPT-5 in use)
kubectl logs -l app=summarize-worker -n default --tail=50 -f
```

### Verify GPT-5 Active:
```bash
# Check deployment config
kubectl get deployment backend -n default -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
# Should output: gpt-5

kubectl get deployment summarize-worker -n default -o jsonpath='{.spec.template.spec.containers[1].env[?(@.name=="AZURE_OPENAI_DEPLOYMENT_NAME")].value}'
# Should output: gpt-5
```

---

## 🧪 Step 5: Test with Real Deposition

1. **Go to your app:** https://your-domain.com
2. **Upload test deposition:** `/Users/bennieking/Sites/testifiAi/Dr. Sackler Depo Transcript.pdf`
3. **Wait for processing:** ~6-10 minutes (241 pages, sequential processing)
4. **Download as PDF** and verify:
   - ✅ Professional cover page with logo
   - ✅ Real transcript page numbers (9-11, 12, etc.)
   - ✅ Detailed 3-6 sentence summaries
   - ✅ Specific names, dates, entities mentioned
   - ✅ Professional table borders

### Expected Quality with GPT-5:
```markdown
| Page Number | Testimony |
|-------------|-----------|
| 9-11 | Introduction of parties and counsel for plaintiffs and 
         defendants in the matter of Commonwealth of Kentucky v. 
         Purdue Pharma L.P. Examination of deponent Richard Sackler, 
         M.D. ("Dr. Sackler") by Tyler Thompson, Counsel for 
         Plaintiff, State of Kentucky. Discussion of purpose of 
         deposition and standard deposition instructions. The witness 
         was sworn in by the court reporter.
| 12 | Discussion of Dr. Sackler's current role at Purdue Pharma. 
      Dr. Sackler confirms his involvement with multiple Purdue 
      entities including Purdue Pharma L.P., Purdue Pharma Inc., 
      and related corporate structures. The Sackler family owns 
      these Purdue entities. Dr. Sackler describes the corporate 
      ownership structure and his responsibilities.
```

---

## 📊 Monitor Costs

### Azure Portal:
```
Azure OpenAI → Cost Management → Cost Analysis
Filter by: Last 7 days, Resource: Your OpenAI resource
```

### Expected Costs:
- **Per deposition (241 pages):** ~$8-10
- **Monthly estimate (100 depositions):** ~$800-1000

---

## 🔧 Troubleshooting

### "Deployment not found" error in worker logs:
```bash
# Verify deployment name in Azure
az cognitiveservices account deployment list \
  --name YOUR_RESOURCE \
  --resource-group YOUR_RG

# If deployment name is different (e.g., "gpt-5-preview"):
kubectl set env deployment/backend AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-preview -n default
kubectl set env deployment/summarize-worker AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-preview -n default
```

### Rate limits (HTTP 429):
- Current config: Sequential processing (1 chunk at a time)
- If still hitting limits: Increase TPM quota in Azure Portal
- Or add longer delays in `summarizeWorker.ts`

### High latency:
- GPT-5 may be slower than GPT-4o
- This is expected for better quality
- Sequential processing prevents rate limits but takes longer

---

## 🎉 You're Done!

Once deployed:
- ✅ Production uses GPT-5
- ✅ Staging uses GPT-5  
- ✅ Ready to test newer models in staging when available
- ✅ Best quality deposition summaries

**Next:** Upload a test deposition and compare quality! 🚀


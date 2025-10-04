# Azure OpenAI Setup Checklist

## Before Pushing to Production

### Step 1: Verify Current Azure Deployments

```bash
# List your current deployments
az cognitiveservices account deployment list \
  --name <YOUR_AZURE_OPENAI_RESOURCE_NAME> \
  --resource-group <YOUR_RESOURCE_GROUP> \
  --query "[].{Name:name, Model:properties.model.name, Status:properties.provisioningState}" \
  --output table
```

### Step 2: Create GPT-5 Deployment (Production)

Go to: https://portal.azure.com

1. **Navigate to your Azure OpenAI resource**
2. **Click "Model deployments" or "Deployments"**
3. **Click "+ Create new deployment"**

**Configuration:**
```
Model: gpt-5 (or gpt-5-preview if gpt-5 not available)
Deployment name: gpt-5
Version: Latest available
Deployment type: Standard
Tokens per minute rate limit: 150,000 (or max available)
Content filter: Default
```

4. **Click "Create"**
5. **Wait for deployment to complete** (~2-3 minutes)

### Step 3: Create/Verify GPT-4o Deployment (Staging)

**Configuration:**
```
Model: gpt-4o
Deployment name: gpt-4o
Version: Latest stable
Deployment type: Standard
Tokens per minute rate limit: 100,000
Content filter: Default
```

### Step 4: Verify Deployments

Once created, verify:

```bash
# Test GPT-5 deployment
curl https://<YOUR_ENDPOINT>.openai.azure.com/openai/deployments/gpt-5/chat/completions?api-version=2024-10-01-preview \
  -H "Content-Type: application/json" \
  -H "api-key: <YOUR_API_KEY>" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'

# Test GPT-4o deployment
curl https://<YOUR_ENDPOINT>.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview \
  -H "Content-Type: application/json" \
  -H "api-key: <YOUR_API_KEY>" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }'
```

### Step 5: Update Deployment Names (if different)

If your deployment names are different from `gpt-5` and `gpt-4o`, update:

**For Production:**
- `backend-deployment.yaml` (line 137)
- `summarize-worker-deployment.yaml` (line 110)

**For Staging:**
- `backend-deployment.staging.yaml` (line 126)
- `summarize-worker-deployment.staging.yaml` (line 110)

### Step 6: Ready to Push!

Once deployments are created and tested:

```bash
git push origin main
```

This will trigger Cloud Build to deploy GPT-5 to production automatically.

---

## Troubleshooting

### "Model not found" in Azure
- GPT-5 might still be in preview/limited access
- Check: https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models
- Fallback: Use `gpt-4-turbo` or `gpt-4o` for now

### "Quota exceeded"
- Check your Azure subscription quota
- Request quota increase in Azure Portal
- Or use lower TPM limits temporarily

### "Deployment name already exists"
- Use different names like:
  - `gpt5-prod` instead of `gpt-5`
  - `gpt4o-staging` instead of `gpt-4o`
- Update the YAML files accordingly


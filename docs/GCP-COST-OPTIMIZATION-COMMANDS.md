# GCP Infrastructure Cost Optimization Commands

This document contains the infrastructure commands to complete the GCP cost optimization migration from GKE to Cloud Run.

## Prerequisites

Ensure you have:
1. `gcloud` CLI installed and authenticated
2. Project set: `gcloud config set project golden-cosmos-450417-i8`
3. Appropriate IAM permissions for Cloud SQL, Compute Engine, and Cloud Run

---

## Phase 2: Downsize Cloud SQL

### 2.1 Change Database Tier

**Current:** `db-custom-4-16384` (4 vCPU, 16GB RAM) - ~$250/month
**Target:** `db-g1-small` (shared vCPU, 1.7GB RAM) - ~$25/month

```bash
# IMPORTANT: This will cause brief downtime during restart
# Schedule during low-traffic period

gcloud sql instances patch testifi \
  --tier=db-g1-small \
  --project=golden-cosmos-450417-i8
```

### 2.2 Optional: Reduce Disk Size

If your database is using less than 10GB of storage, you can reduce costs further.
Note: Disk reduction requires recreation of the instance (data export/import).

```bash
# Check current disk usage first
gcloud sql instances describe testifi --format="get(settings.dataDiskSizeGb)"
```

---

## Phase 3: Domain Mapping (If Not Already Done)

Map custom domains to Cloud Run services:

```bash
# Production frontend
gcloud run domain-mappings create \
  --service testifi-frontend \
  --domain app.testifi.ai \
  --region us-central1

# Staging frontend
gcloud run domain-mappings create \
  --service testifi-frontend-staging \
  --domain staging.app.testifi.ai \
  --region us-central1
```

Update your DNS records to point to the Cloud Run endpoints. Get the required DNS records:

```bash
gcloud run domain-mappings describe \
  --domain app.testifi.ai \
  --region us-central1
```

---

## Phase 6: Cleanup Old Resources

**IMPORTANT:** Only run these commands AFTER verifying Cloud Run deployment is working correctly!

### 6.1 Delete GKE Cluster

Saves ~$245/month

```bash
# First, verify Cloud Run is serving traffic successfully
curl -sf https://app.testifi.ai/api/health && echo "Production OK"
curl -sf https://staging.app.testifi.ai/api/health && echo "Staging OK"

# If both succeed, delete the GKE cluster
gcloud container clusters delete testifi \
  --zone us-central1-c \
  --project=golden-cosmos-450417-i8
```

### 6.2 Delete Standalone VM

Saves ~$50/month

```bash
# List VMs to confirm the correct one
gcloud compute instances list --project=golden-cosmos-450417-i8

# Delete the VM
gcloud compute instances delete testifi-prod-vm \
  --zone us-central1-c \
  --project=golden-cosmos-450417-i8
```

### 6.3 Release Unused Static IPs

Saves ~$5-10/month

```bash
# List static IPs
gcloud compute addresses list --project=golden-cosmos-450417-i8

# Release unused IPs (adjust names as needed)
gcloud compute addresses delete testifi-prod-ip \
  --region us-central1 \
  --project=golden-cosmos-450417-i8

gcloud compute addresses delete testifi-staging-ip \
  --region us-central1 \
  --project=golden-cosmos-450417-i8
```

### 6.4 Delete Unused Load Balancers

```bash
# List forwarding rules (load balancer frontends)
gcloud compute forwarding-rules list --project=golden-cosmos-450417-i8

# Delete if no longer needed
gcloud compute forwarding-rules delete [FORWARDING_RULE_NAME] \
  --region us-central1 \
  --project=golden-cosmos-450417-i8
```

---

## Verification Commands

### Check Cloud Run Services

```bash
# List all Cloud Run services
gcloud run services list --region us-central1

# Check backend status
gcloud run services describe testifi-backend --region us-central1

# Check frontend status
gcloud run services describe testifi-frontend --region us-central1

# Check worker status
gcloud run services describe testifi-summarize-worker --region us-central1
```

### Check Cloud SQL

```bash
gcloud sql instances describe testifi --format="yaml(settings.tier,settings.dataDiskSizeGb,state)"
```

### Check Billing Estimates

```bash
# View current billing
gcloud billing accounts list
gcloud billing projects describe golden-cosmos-450417-i8
```

---

## Estimated New Monthly Costs

| Service | Configuration | Est. Cost |
|---------|--------------|-----------|
| Cloud Run Backend (prod) | 0-3 instances, scales to zero | ~$5-15 |
| Cloud Run Backend (staging) | 0-2 instances | ~$2-5 |
| Cloud Run Frontend (both) | Static serving | ~$2-5 |
| Cloud Run Worker | 1 min instance (always-on) | ~$25 |
| Cloud SQL | db-g1-small, 10GB | ~$27 |
| Cloud Storage | Container images, backups | ~$5 |
| **Total** | | **~$65-80/month** |

---

## Rollback Plan

If issues arise, the GKE cluster can be recreated:

```bash
# Recreate GKE cluster
gcloud container clusters create testifi \
  --zone us-central1-c \
  --num-nodes 2 \
  --machine-type e2-small \
  --project=golden-cosmos-450417-i8

# Get credentials
gcloud container clusters get-credentials testifi --zone us-central1-c

# Apply existing Kubernetes configs
kubectl apply -f backend-deployment.yaml
kubectl apply -f loveable/frontend-deployment.yaml
kubectl apply -f summarize-worker-deployment.yaml
```

---

## Risk Mitigation Notes

1. **Cold starts**: Cloud Run may have 2-5 second cold starts. For 150 users, this is acceptable. Set `min-instances=1` if needed (~$25/month extra).

2. **WebSocket support**: Cloud Run supports WebSockets with HTTP/2. Verify if your app uses them.

3. **Background jobs**: The summarize worker runs with `min-instances=1` for polling. Alternative: Convert to Cloud Tasks/Pub-Sub for $0 idle cost.

4. **Database connections**: Cloud Run can exhaust connection pools. The current setup uses Cloud SQL Auth Proxy built into Cloud Run for efficient connection management.

# 🚀 Final Production Stripe Setup

## Current Status
- ✅ **Stripe CLI**: Previously configured during setup
- ✅ **Test Webhook**: Created (signing secret redacted)
- ❌ **Live Webhook**: Needs to be created via Dashboard
- ❌ **Production Keys**: Need to be updated

## 🔧 Manual Production Setup (Recommended)

Since the Stripe CLI has permission issues with live mode, let's set up production manually:

### Step 1: Get Live Stripe Keys from Dashboard
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. Make sure you're in **Live mode** (toggle in top-left)
3. Copy your **Secret key** (starts with `sk_live_`)
4. Copy your **Publishable key** (starts with `pk_live_`)

### Step 2: Create Live Webhook via Dashboard
1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. **Endpoint URL**: `https://app.testifi.ai/api/purchase/stripe-webhook`
4. **Events to send**:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `checkout.session.completed`
5. Click **"Add endpoint"**
6. Copy the **Signing secret** (starts with `whsec_`)

### Step 3: Update Secret Manager Secrets
```bash
# Update Stripe API Key (replace with your actual live key)
printf "%s" "sk_live_YOUR_ACTUAL_KEY" | gcloud secrets versions add backend-secrets-STRIPE_API_KEY \
  --project=golden-cosmos-450417-i8 \
  --data-file=-

# Update Stripe Webhook Secret (replace with your actual webhook secret)
printf "%s" "whsec_YOUR_ACTUAL_SECRET" | gcloud secrets versions add backend-secrets-STRIPE_WEBHOOK_SECRET \
  --project=golden-cosmos-450417-i8 \
  --data-file=-
```

### Step 4: Restart Cloud Run Backend
```bash
gcloud run services update testifi-backend \
  --project=golden-cosmos-450417-i8 \
  --region=us-central1 \
  --update-env-vars="STRIPE_CONFIG_REFRESH=$(date +%s)"
```

### Step 5: Verify Setup
```bash
# Check deployment status
kubectl rollout status deployment/backend
kubectl rollout status deployment/summarize-worker

# Check logs
kubectl logs -l app=backend | grep -i stripe
```

## 🧪 Test Production Setup

### 1. Test Webhook Delivery
```bash
# Send a test webhook
stripe events resend evt_test_webhook --live
```

### 2. Test Small Payment
- Go to your production app
- Try a small test payment
- Check Stripe Dashboard for the transaction
- Verify webhook delivery

### 3. Monitor Logs
```bash
# Watch backend logs
kubectl logs -l app=backend -f

# Check for Stripe-related errors
kubectl logs -l app=backend | grep -i "stripe\|payment\|webhook"
```

## 📋 Environment Summary

### Staging Environment:
- **Stripe Keys**: Test keys (`sk_test_...`)
- **Webhook**: Test webhook signing secret stored in Secret Manager
- **Purpose**: Development and testing

### Production Environment:
- **Stripe Keys**: Live keys (`sk_live_...`)
- **Webhook**: Live webhook (from Dashboard)
- **Purpose**: Real payments and transactions

## 🔍 Verification Commands

### Check Current Secrets:
```bash
# View current Stripe configuration
kubectl get secret backend-secrets -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d
kubectl get secret backend-secrets -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d
```

### Check Deployment Status:
```bash
# Check pod status
kubectl get pods

# Check deployment status
gcloud run services describe testifi-backend \
  --project=golden-cosmos-450417-i8 \
  --region=us-central1
```

## 🚨 Important Notes

### Security:
- ✅ **Never commit live keys to git**
- ✅ **Use Secret Manager for storage**
- ✅ **Rotate keys periodically**
- ❌ **Don't use test keys in production**

### Testing:
- ✅ **Test with small amounts first**
- ✅ **Monitor Stripe Dashboard**
- ✅ **Check application logs**
- ❌ **Don't test with large amounts**

## 🎯 Production Checklist

### Before Going Live:
- [ ] **Live Stripe Keys**: Updated in Kubernetes
- [ ] **Live Webhook**: Created via Dashboard
- [ ] **SSL Certificate**: Valid for production domain
- [ ] **Database**: Production database configured
- [ ] **Email**: Production email service configured
- [ ] **Monitoring**: Error tracking set up

### After Going Live:
- [ ] **Test Payment**: Small test transaction
- [ ] **Webhook Delivery**: Verify webhooks are received
- [ ] **Application Logs**: No errors in logs
- [ ] **Stripe Dashboard**: Transactions appearing
- [ ] **User Experience**: Payment flow working

## 🎉 Success Indicators

### Production is Ready When:
- ✅ **Live Stripe keys** are configured
- ✅ **Live webhook endpoint** is receiving events
- ✅ **Test payments** are successful
- ✅ **Application logs** show no errors
- ✅ **Stripe Dashboard** shows transactions

### Next Steps:
1. **Monitor closely** for the first few days
2. **Set up alerts** for payment failures
3. **Regular backups** of transaction data
4. **Performance monitoring** for payment processing

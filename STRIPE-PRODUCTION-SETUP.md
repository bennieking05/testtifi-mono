# 🔐 Stripe Production Setup Guide

## Current Status
- ✅ **Stripe CLI**: Logged in and configured
- ✅ **Test Keys**: Working in staging
- ❌ **Production Keys**: Need to be set up

## 🚀 Quick Setup Steps

### Step 1: Get Your Live Stripe Keys
```bash
# Run this to see your keys (they may be masked for security)
./get-stripe-keys.sh
```

**Alternative**: Go to [Stripe Dashboard](https://dashboard.stripe.com/apikeys) and copy:
- **Secret Key**: `sk_live_...` (for backend)
- **Publishable Key**: `pk_live_...` (for frontend)

### Step 2: Set Up Production Webhook
```bash
# Create webhook endpoint for production
stripe webhook_endpoints create \
  --url="https://app.testifi.ai/api/purchase/webhook" \
  --enabled-events="payment_intent.succeeded,payment_intent.payment_failed,checkout.session.completed"
```

### Step 3: Update Production Secrets
```bash
# Run the production setup script
./setup-production-stripe.sh
```

**Or manually update:**
```bash
# Update Stripe API Key
kubectl patch secret backend-secrets --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_API_KEY", "value": "'$(echo -n "sk_live_YOUR_KEY" | base64)'"}]'

# Update Stripe Webhook Secret
kubectl patch secret backend-secrets --type='json' -p='[{"op": "replace", "path": "/data/STRIPE_WEBHOOK_SECRET", "value": "'$(echo -n "whsec_YOUR_SECRET" | base64)'"}]'
```

### Step 4: Restart Deployments
```bash
kubectl rollout restart deployment/backend
kubectl rollout restart deployment/summarize-worker
```

## 📋 Environment Strategy

### Staging Environment:
- **Stripe Keys**: Test keys (`sk_test_...`)
- **Webhook**: Test webhook endpoint
- **Purpose**: Development and testing

### Production Environment:
- **Stripe Keys**: Live keys (`sk_live_...`)
- **Webhook**: Production webhook endpoint
- **Purpose**: Real payments and transactions

## 🧪 Testing Production Setup

### 1. Test Small Payment:
```bash
# Create a test payment intent
stripe payment_intents create \
  --amount=100 \
  --currency=usd \
  --description="Test payment for production setup"
```

### 2. Monitor Webhooks:
```bash
# Listen for webhook events
stripe listen --forward-to https://app.testifi.ai/api/purchase/webhook
```

### 3. Check Application Logs:
```bash
# Monitor backend logs
kubectl logs -l app=backend -f

# Check for Stripe-related errors
kubectl logs -l app=backend | grep -i stripe
```

## 🔍 Verification Commands

### Check Current Secrets:
```bash
# View Stripe configuration
kubectl get secret backend-secrets -o jsonpath='{.data.STRIPE_API_KEY}' | base64 -d
kubectl get secret backend-secrets -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d
```

### Check Deployment Status:
```bash
# Check pod status
kubectl get pods

# Check deployment status
kubectl rollout status deployment/backend
kubectl rollout status deployment/summarize-worker
```

## 🚨 Important Notes

### Security:
- ✅ **Never commit live keys to git**
- ✅ **Use Kubernetes secrets for storage**
- ✅ **Rotate keys periodically**
- ❌ **Don't use test keys in production**

### Testing:
- ✅ **Test with small amounts first**
- ✅ **Monitor Stripe Dashboard**
- ✅ **Check application logs**
- ❌ **Don't test with large amounts**

### Monitoring:
- ✅ **Set up Stripe Dashboard alerts**
- ✅ **Monitor payment success rates**
- ✅ **Check webhook delivery**
- ✅ **Monitor application errors**

## 🎯 Production Checklist

### Before Going Live:
- [ ] **Live Stripe Keys**: Updated in Kubernetes
- [ ] **Webhook Endpoint**: Created and configured
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

## 📞 Support

### If Issues Occur:
1. **Check Stripe Dashboard**: For transaction status
2. **Check Application Logs**: For error messages
3. **Check Webhook Logs**: For delivery issues
4. **Test with Stripe CLI**: For API connectivity

### Emergency Rollback:
```bash
# Rollback to previous deployment
kubectl rollout undo deployment/backend
kubectl rollout undo deployment/summarize-worker
```

## 🎉 Success Indicators

### Production is Ready When:
- ✅ **Live Stripe keys** are configured
- ✅ **Webhook endpoint** is receiving events
- ✅ **Test payments** are successful
- ✅ **Application logs** show no errors
- ✅ **Stripe Dashboard** shows transactions

### Next Steps:
1. **Monitor closely** for the first few days
2. **Set up alerts** for payment failures
3. **Regular backups** of transaction data
4. **Performance monitoring** for payment processing

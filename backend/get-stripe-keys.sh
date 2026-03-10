#!/bin/bash

# Get Stripe Keys Script
# This script helps extract the actual Stripe keys

echo "🔑 Getting Stripe Keys for Production Setup"
echo ""

# Check if stripe CLI is available
if ! command -v stripe &> /dev/null; then
    echo "❌ Stripe CLI not found. Please install it first."
    exit 1
fi

# Check if logged in
if ! stripe config --list | grep -q "live_mode_api_key"; then
    echo "❌ Not logged into Stripe CLI"
    echo "Please run: stripe login"
    exit 1
fi

echo "✅ Stripe CLI is configured"
echo ""

echo "📋 Your Stripe Keys:"
echo ""

# Get the actual keys (they should be visible in the config)
echo "🔑 Live API Key (Secret):"
stripe config --list | grep "live_mode_api_key" | sed "s/.*'\(.*\)'.*/\1/"

echo ""
echo "🔑 Live Publishable Key:"
stripe config --list | grep "live_mode_pub_key" | sed "s/.*'\(.*\)'.*/\1/"

echo ""
echo "📋 Account Info:"
stripe config --list | grep -E "(account_id|display_name)"

echo ""
echo "🎯 Next Steps:"
echo "1. Copy the live API key (starts with sk_live_)"
echo "2. Run: ./setup-production-stripe.sh"
echo "3. Enter the live API key when prompted"
echo ""
echo "⚠️  Keep these keys secure and never commit them to git!"

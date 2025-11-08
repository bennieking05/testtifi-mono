#!/bin/bash
# Create Azure OpenAI deployments for GPT-5 (production) and GPT-4o (staging)

set -e

echo "🚀 Azure OpenAI Deployment Setup"
echo "=================================="
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Install it first:"
    echo "   brew install azure-cli"
    exit 1
fi

# Check if logged in
if ! az account show &> /dev/null; then
    echo "🔐 Not logged in to Azure. Logging in..."
    az login
fi

echo "📋 Current Azure subscription:"
az account show --query "{Name:name, SubscriptionId:id}" -o table
echo ""

# Get user input
read -p "Azure OpenAI Resource Name: " RESOURCE_NAME
read -p "Resource Group: " RESOURCE_GROUP

echo ""
echo "🔍 Verifying resource exists..."
if ! az cognitiveservices account show \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" &> /dev/null; then
    echo "❌ Resource not found: $RESOURCE_NAME in $RESOURCE_GROUP"
    echo "Available resources:"
    az cognitiveservices account list --resource-group "$RESOURCE_GROUP" --query "[].name" -o table
    exit 1
fi

echo "✅ Resource found: $RESOURCE_NAME"
echo ""

# Check current deployments
echo "📋 Current deployments:"
az cognitiveservices account deployment list \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[].{Name:name, Model:properties.model.name, Status:properties.provisioningState}" \
    -o table
echo ""

# Function to create deployment
create_deployment() {
    local DEPLOYMENT_NAME=$1
    local MODEL_NAME=$2
    local MODEL_VERSION=$3
    local CAPACITY=$4
    local DESCRIPTION=$5
    
    echo "📦 Creating deployment: $DEPLOYMENT_NAME"
    echo "   Model: $MODEL_NAME"
    echo "   Version: $MODEL_VERSION"
    echo "   Capacity: $CAPACITY TPM"
    echo ""
    
    # Check if deployment already exists
    if az cognitiveservices account deployment show \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$DEPLOYMENT_NAME" &> /dev/null; then
        echo "⚠️  Deployment '$DEPLOYMENT_NAME' already exists"
        read -p "   Delete and recreate? (y/n): " RECREATE
        if [[ "$RECREATE" == "y" ]]; then
            echo "   Deleting existing deployment..."
            az cognitiveservices account deployment delete \
                --name "$RESOURCE_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --deployment-name "$DEPLOYMENT_NAME" \
                --yes
            echo "   Waiting for deletion to complete..."
            sleep 10
        else
            echo "   Skipping..."
            return
        fi
    fi
    
    # Create deployment
    az cognitiveservices account deployment create \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$DEPLOYMENT_NAME" \
        --model-name "$MODEL_NAME" \
        --model-version "$MODEL_VERSION" \
        --model-format OpenAI \
        --sku-capacity "$CAPACITY" \
        --sku-name "Standard"
    
    if [ $? -eq 0 ]; then
        echo "✅ Deployment '$DEPLOYMENT_NAME' created successfully!"
    else
        echo "❌ Failed to create deployment '$DEPLOYMENT_NAME'"
        echo "   This might be due to:"
        echo "   - Model not available in your region"
        echo "   - Insufficient quota"
        echo "   - Model requires special access (GPT-5 preview)"
        return 1
    fi
    echo ""
}

# Deployment configurations
echo "🎯 Creating GPT-5 deployment for both production and staging"
echo "   (Staging can be upgraded to test newer models in the future)"
echo ""
read -p "Continue? (y/n): " CONTINUE

if [[ "$CONTINUE" != "y" ]]; then
    echo "❌ Aborted"
    exit 0
fi

CHOICE=3  # Always create both

case $CHOICE in
    1|3)
        echo ""
        echo "═══════════════════════════════════════"
        echo "🚀 PRODUCTION DEPLOYMENT (GPT-5)"
        echo "═══════════════════════════════════════"
        echo ""
        
        # Check if GPT-5 is available
        echo "📋 Checking available GPT-5 models..."
        AVAILABLE_MODELS=$(az cognitiveservices account list-models \
            --name "$RESOURCE_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --query "[?contains(name, 'gpt-5')].name" -o tsv 2>/dev/null)
        
        if [ -z "$AVAILABLE_MODELS" ]; then
            echo "⚠️  GPT-5 not available in your resource/region"
            echo "   Available alternatives:"
            az cognitiveservices account list-models \
                --name "$RESOURCE_NAME" \
                --resource-group "$RESOURCE_GROUP" \
                --query "[?contains(name, 'gpt')].{Name:name, Version:version}" -o table
            echo ""
            read -p "Enter model name to use instead (e.g., gpt-4-turbo): " ALT_MODEL
            GPT5_MODEL="$ALT_MODEL"
            read -p "Enter model version (or 'latest'): " GPT5_VERSION
        else
            echo "✅ GPT-5 models found:"
            echo "$AVAILABLE_MODELS"
            GPT5_MODEL=$(echo "$AVAILABLE_MODELS" | head -1)
            echo "   Using: $GPT5_MODEL"
            GPT5_VERSION="latest"
        fi
        
        echo ""
        read -p "Deployment name (default: gpt-5): " GPT5_NAME
        GPT5_NAME=${GPT5_NAME:-gpt-5}
        
        read -p "TPM capacity (default: 150000): " GPT5_CAPACITY
        GPT5_CAPACITY=${GPT5_CAPACITY:-150}
        
        create_deployment "$GPT5_NAME" "$GPT5_MODEL" "$GPT5_VERSION" "$GPT5_CAPACITY" "Production GPT-5 for best quality summaries"
        
        # Update YAML files if name is different
        if [ "$GPT5_NAME" != "gpt-5" ]; then
            echo "⚙️  Updating deployment configs with name: $GPT5_NAME"
            sed -i.bak "s/value: \"gpt-5\"/value: \"$GPT5_NAME\"/" backend-deployment.yaml
            sed -i.bak "s/value: \"gpt-5\"/value: \"$GPT5_NAME\"/" summarize-worker-deployment.yaml
            echo "✅ Updated deployment configs"
        fi
        
        if [ "$CHOICE" != "3" ]; then
            break
        fi
        ;;
esac

case $CHOICE in
    2|3)
        echo ""
        echo "═══════════════════════════════════════"
        echo "🧪 STAGING DEPLOYMENT (GPT-5 - same as production)"
        echo "═══════════════════════════════════════"
        echo ""
        echo "Note: Both production and staging will use the same GPT-5 deployment."
        echo "In the future, you can create a separate deployment (e.g., gpt-6-preview)"
        echo "for staging to test before moving to production."
        echo ""
        echo "✅ Staging will use the same '$GPT5_NAME' deployment as production"
        echo ""
        ;;
esac

# Show final deployments
echo ""
echo "═══════════════════════════════════════"
echo "📊 Final Deployment Status"
echo "═══════════════════════════════════════"
echo ""

az cognitiveservices account deployment list \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "[].{Name:name, Model:properties.model.name, Version:properties.model.version, Capacity:sku.capacity, Status:properties.provisioningState}" \
    -o table

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "   1. Verify deployments are 'Succeeded'"
echo "   2. Test the deployments (see test command below)"
echo "   3. Commit any config changes: git add . && git commit -m 'Update deployment names'"
echo "   4. Push to deploy: git push origin main"
echo ""

# Get endpoint for testing
ENDPOINT=$(az cognitiveservices account show \
    --name "$RESOURCE_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.endpoint" -o tsv)

echo "🧪 Test your deployments:"
echo ""
if [ -n "$GPT5_NAME" ]; then
    echo "# Test GPT-5 (Production):"
    echo "curl $ENDPOINT/openai/deployments/$GPT5_NAME/chat/completions?api-version=2024-10-01-preview \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -H 'api-key: YOUR_API_KEY' \\"
    echo "  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"max_tokens\":10}'"
    echo ""
fi

if [ -n "$GPT4O_NAME" ]; then
    echo "# Test GPT-4o (Staging):"
    echo "curl $ENDPOINT/openai/deployments/$GPT4O_NAME/chat/completions?api-version=2024-08-01-preview \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -H 'api-key: YOUR_API_KEY' \\"
    echo "  -d '{\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}],\"max_tokens\":10}'"
    echo ""
fi

echo "✅ All done! Your TestifiAI backend is ready for GPT-5! 🚀"


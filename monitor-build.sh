#!/bin/bash
# Monitor Cloud Build for staging builds

echo "=========================================="
echo "Cloud Build Monitor - Staging"
echo "=========================================="
echo ""

LAST_BUILD_ID=""
CHECK_INTERVAL=30

while true; do
    # Get the most recent build
    CURRENT_BUILD=$(gcloud builds list --limit=1 --format="value(id,status,createTime)" --sort-by=~createTime 2>/dev/null)
    
    if [ -z "$CURRENT_BUILD" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S'): No builds found. Waiting..."
        sleep $CHECK_INTERVAL
        continue
    fi
    
    BUILD_ID=$(echo "$CURRENT_BUILD" | awk '{print $1}')
    BUILD_STATUS=$(echo "$CURRENT_BUILD" | awk '{print $2}')
    BUILD_TIME=$(echo "$CURRENT_BUILD" | awk '{print $3}')
    
    # Check if this is a new build
    if [ "$BUILD_ID" != "$LAST_BUILD_ID" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S'): New build detected: $BUILD_ID"
        echo "  Status: $BUILD_STATUS"
        echo "  Time: $BUILD_TIME"
        LAST_BUILD_ID=$BUILD_ID
        
        # If build is running, stream logs
        if [ "$BUILD_STATUS" = "WORKING" ] || [ "$BUILD_STATUS" = "QUEUED" ]; then
            echo "  Build is running. Streaming logs..."
            gcloud builds log --stream "$BUILD_ID" 2>/dev/null || true
        fi
        
        # If build succeeded, test endpoints
        if [ "$BUILD_STATUS" = "SUCCESS" ]; then
            echo ""
            echo "=========================================="
            echo "Build SUCCESS! Testing endpoints..."
            echo "=========================================="
            echo ""
            cd /Users/bennieking/Sites/testifiAi
            ./test-staging-endpoints.sh
            echo ""
            echo "=========================================="
            echo "Monitoring complete. Exiting."
            echo "=========================================="
            break
        elif [ "$BUILD_STATUS" = "FAILURE" ] || [ "$BUILD_STATUS" = "CANCELLED" ] || [ "$BUILD_STATUS" = "TIMEOUT" ]; then
            echo "  Build failed. Checking logs..."
            gcloud builds log "$BUILD_ID" --limit=50 2>/dev/null | tail -20
            echo ""
            echo "Waiting for next build..."
        fi
    else
        # Same build, check if status changed
        if [ "$BUILD_STATUS" = "WORKING" ] || [ "$BUILD_STATUS" = "QUEUED" ]; then
            echo -n "."
        elif [ "$BUILD_STATUS" = "SUCCESS" ]; then
            echo ""
            echo "=========================================="
            echo "Build SUCCESS! Testing endpoints..."
            echo "=========================================="
            echo ""
            cd /Users/bennieking/Sites/testifiAi
            ./test-staging-endpoints.sh
            echo ""
            echo "=========================================="
            echo "Monitoring complete. Exiting."
            echo "=========================================="
            break
        fi
    fi
    
    sleep $CHECK_INTERVAL
done

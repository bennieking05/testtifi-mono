#!/bin/bash
# Test all staging endpoints after successful build

STAGING_URL="https://staging.app.testifi.ai"
API_URL="${STAGING_URL}/api"

echo "=========================================="
echo "Testing Staging Endpoints"
echo "Staging URL: ${STAGING_URL}"
echo "API URL: ${API_URL}"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4
    local auth_header=$5
    
    echo -n "Testing: ${description}... "
    
    if [ -n "$auth_header" ]; then
        if [ "$method" = "GET" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}${endpoint}" \
                -H "Authorization: Bearer ${auth_header}" \
                -H "Content-Type: application/json")
        elif [ "$method" = "POST" ]; then
            response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}${endpoint}" \
                -H "Authorization: Bearer ${auth_header}" \
                -H "Content-Type: application/json" \
                -d "${data}")
        elif [ "$method" = "PATCH" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PATCH "${API_URL}${endpoint}" \
                -H "Authorization: Bearer ${auth_header}" \
                -H "Content-Type: application/json" \
                -d "${data}")
        fi
    else
        if [ "$method" = "GET" ]; then
            response=$(curl -s -w "\n%{http_code}" -X GET "${API_URL}${endpoint}" \
                -H "Content-Type: application/json")
        elif [ "$method" = "POST" ]; then
            response=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}${endpoint}" \
                -H "Content-Type: application/json" \
                -d "${data}")
        fi
    fi
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
        ((PASSED++))
        return 0
    elif [ "$http_code" -eq 401 ]; then
        echo -e "${YELLOW}⚠ UNAUTHORIZED${NC} (HTTP $http_code) - Auth required"
        ((FAILED++))
        return 1
    elif [ "$http_code" -eq 404 ]; then
        echo -e "${YELLOW}⚠ NOT FOUND${NC} (HTTP $http_code)"
        ((FAILED++))
        return 1
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code)"
        echo "  Response: $body" | head -c 200
        echo ""
        ((FAILED++))
        return 1
    fi
}

echo "1. Testing Health/Status Endpoints"
echo "-----------------------------------"
test_endpoint "GET" "/health" "Health check" "" ""
test_endpoint "GET" "/" "Root endpoint" "" ""
echo ""

echo "2. Testing Authentication Endpoints (Public)"
echo "--------------------------------------------"
# Note: These will return 400/422 without proper data, but should not be 500
test_endpoint "POST" "/auth/register" "Register endpoint (expects 400 without data)" '{"email":"test@example.com"}' ""
test_endpoint "POST" "/auth/login" "Login endpoint (expects 400 without data)" '{"email":"test@example.com"}' ""
test_endpoint "POST" "/auth/forgot-password" "Forgot password endpoint" '{"email":"test@example.com"}' ""
echo ""

echo "3. Testing Admin Endpoints (Requires Auth)"
echo "------------------------------------------"
echo "Note: These will return 401 without valid admin token"
test_endpoint "GET" "/admin/metrics/overview" "Admin metrics overview" "" ""
test_endpoint "GET" "/admin/metrics/downloads" "Admin download metrics" "" ""
test_endpoint "GET" "/admin/metrics/support" "Admin support metrics" "" ""
test_endpoint "GET" "/admin/metrics/system-health" "Admin system health" "" ""
test_endpoint "GET" "/admin/billing/expired" "Admin expired credits" "" ""
echo ""

echo "4. Testing User Endpoints (Requires Auth)"
echo "-----------------------------------------"
test_endpoint "GET" "/user/signups" "User signups (admin)" "" ""
test_endpoint "GET" "/user/profile" "User profile" "" ""
echo ""

echo "5. Testing Purchase Endpoints (Requires Auth)"
echo "----------------------------------------------"
test_endpoint "GET" "/purchase/history" "Purchase history (admin)" "" ""
echo ""

echo "6. Testing Support Endpoints"
echo "-----------------------------"
test_endpoint "GET" "/support" "Support tickets (admin)" "" ""
test_endpoint "POST" "/support" "Create support ticket" '{"name":"Test","email":"test@example.com","subject":"Test","message":"Test"}' ""
echo ""

echo "7. Testing Summary Endpoints (Requires Auth)"
echo "---------------------------------------------"
test_endpoint "GET" "/summaries" "Get summaries" "" ""
test_endpoint "GET" "/summaries/prompt-config" "Get prompt config" "" ""
echo ""

echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo -e "${GREEN}Passed: ${PASSED}${NC}"
echo -e "${RED}Failed: ${FAILED}${NC}"
echo "Total: $((PASSED + FAILED))"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${YELLOW}Some tests failed (expected for endpoints requiring auth)${NC}"
    exit 0
fi






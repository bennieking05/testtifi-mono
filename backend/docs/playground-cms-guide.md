# Playground CMS Feature Guide

## Overview

The Playground CMS (Content Management System) allows administrators to manage prompts, configurations, and page content with version control and staging-to-production promotion workflows. This feature is **only available in staging environments** for safety and testing.

## Key Features

### 1. Conditional Playground Access
- **Staging**: Playground features enabled (`ENABLE_PLAYGROUND=true`)
- **Production**: Playground features disabled (`ENABLE_PLAYGROUND=false`)
- Prevents accidental changes to production configurations

### 2. Config Promotion System
- Save prompt configurations as versions
- Compare old vs new configurations
- Promote tested configurations to production
- Revert to previous versions

### 3. Content Management System
- Edit page content (Help, Support, Landing, etc.)
- Live preview before promoting
- Version history with rollback
- Git integration for production deployment

### 4. Prompt Performance Metrics
- Track token usage per summary
- Monitor costs by model
- Compare performance across config versions
- Analyze processing times

## How to Use

### Accessing the Admin Dashboard

1. **Login** as an admin user
2. Navigate to **Admin Dashboard** from the sidebar
3. You'll see new tabs:
   - **Prompt Playground** (staging only)
   - **Config Promotion** (new)
   - **Content Management** (new)

### Using Config Promotion

#### Step 1: Edit Configuration
1. Go to **Admin Dashboard** → **Prompt Playground** tab
2. Edit the system prompt, temperature, or max tokens
3. Click **Save** to update staging configuration

#### Step 2: Create Version
1. Go to **Config Promotion** tab
2. Review your changes
3. Click **Save Version** to create a snapshot

#### Step 3: Compare & Test
1. Generate test summaries with the new configuration
2. Compare results with previous versions
3. Review token usage and costs

#### Step 4: Promote to Production
1. Click **Promote to Production** button
2. Confirm the action
3. Changes are automatically committed to git and deployed

#### Step 5: Monitor Performance
1. Go to **Admin Dashboard** → **Metrics** tab
2. View **Prompt Performance** metrics
3. Track usage, costs, and processing times

### Using Content Management

#### Step 1: Select Page
1. Go to **Admin Dashboard** → **Content Management** tab
2. Select a page from the dropdown (e.g., `/help`)

#### Step 2: Edit Content
1. Click **Edit** button
2. Modify sections:
   - Change section type (heading, paragraph, list)
   - Update text content
   - Add or remove sections
3. Click **Save to Staging**

#### Step 3: Preview Changes
1. Toggle **Preview** mode to see rendered content
2. Verify formatting and layout

#### Step 4: Promote to Production
1. Click **Promote to Production** button
2. Confirm the action
3. Content is deployed to live site

#### Step 5: Version History
1. View version history in the table
2. Click **Revert** to restore previous versions

## Metrics & Analytics

### Prompt Performance Metrics
Available at `/api/admin/metrics/prompt-performance`:

```json
{
  "totalJobs": 150,
  "avgTokensPerJob": 2500,
  "totalCost": 45.50,
  "avgCostPerJob": 0.30,
  "avgProcessingTime": 12.5,
  "byModel": {
    "gpt-5-testifi": {
      "count": 100,
      "avgTokens": 2800,
      "avgCost": 0.35
    }
  }
}
```

### Config Version Metrics
Available at `/api/admin/metrics/config-versions`:

```json
[
  {
    "id": "clx123...",
    "version": 1,
    "createdAt": "2025-10-26T...",
    "promotedAt": "2025-10-26T...",
    "isProduction": true,
    "jobCount": 50,
    "avgTokens": 2450,
    "totalCost": 15.00
  }
]
```

## Dynamic Content Rendering

Pages can now fetch content from the database instead of hardcoded text:

```typescript
import { usePageContent, renderContentSection } from "@/hooks/usePageContent";

function MyPage() {
  const { data: content, isLoading } = usePageContent("/help");
  
  if (isLoading) return <div>Loading...</div>;
  
  return (
    <div>
      {content?.sections.map(renderContentSection)}
    </div>
  );
}
```

## Database Schema

### PromptConfigVersion
Stores prompt configuration versions:
- `system`: System prompt text
- `temperature`: Temperature setting
- `maxTokens`: Max tokens setting
- `isProduction`: Production flag
- `createdAt`, `promotedAt`: Timestamps

### PageContent
Stores page content:
- `route`: Page route (e.g., "/help")
- `sections`: JSON array of content sections
- `version`: Version number
- `isProduction`: Production flag

### ConfigComparison
Tracks configuration comparisons:
- `oldVersionId`, `newVersionId`: Versions compared
- `status`: Comparison status
- `oldSummaryJobId`, `newSummaryJobId`: Test summaries

## Git Integration

The promotion system automatically:
1. Saves config/content to repository files
2. Commits changes with descriptive messages
3. Pushes to main branch
4. Triggers Cloud Build deployment

## Security

- **Admin-only access**: All features require admin role
- **Confirmation modals**: Prevents accidental promotions
- **Staging-only editing**: Production is read-only
- **Audit trail**: All changes logged with timestamps

## Environment Variables

Required in `.env`:

**Staging:**
```bash
ENABLE_PLAYGROUND=true
ENABLE_CMS=true
GITHUB_TOKEN=your_token_here
```

**Production:**
```bash
ENABLE_PLAYGROUND=false
ENABLE_CMS=true
GITHUB_TOKEN=your_token_here
```

## Troubleshooting

### Config Promotion Fails
- Check `GITHUB_TOKEN` is set correctly
- Verify git repository access
- Check Cloud Build logs

### Content Not Updating
- Clear browser cache
- Check database content is correct
- Verify API endpoint is responding

### Metrics Not Showing
- Ensure jobs have `tokensUsed` and `costEstimate` set
- Check `configVersionId` is populated
- Verify model names are consistent

## Best Practices

1. **Always test in staging first** before promoting
2. **Create versions** before making major changes
3. **Monitor metrics** after promoting to production
4. **Use descriptive commit messages** for traceability
5. **Review changes** in preview mode before saving
6. **Keep versions** of important configurations

## Support

For issues or questions:
- Check Cloud Build logs
- Review database schema
- Contact development team
- File a support ticket















N and @perNetwee# Admin Dashboard KPI Enhancement - Loveable.dev Prompt

**INSTRUCTIONS: Copy and paste this entire prompt into Loveable.dev chat interface at:**
https://lovable.dev/projects/308eeec9-a2cf-43d7-8f93-8cdbdb4c350c

---

## Context
Create a comprehensive Admin Analytics Dashboard for Testifi AI with Overview and Analytics tabs.

**Project Details:**
- Legal deposition AI summarization SaaS platform
- Stack: React + TypeScript + Vite + shadcn/ui + Recharts + TanStack Query
- Existing admin dashboard at `/loveable/src/pages/Admin.tsx` with tabs
- Color scheme: Primary #5674BC, dark mode supported
- Backend APIs already implemented at `/api/admin/metrics/*`

## Task: Create 4 New Files + Modify 1 Existing File

---

### 1. CREATE: `src/components/admin/KPICard.tsx`

Create a reusable metric card component:

```typescript
interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { 
    value: number; 
    direction: "up" | "down"; 
    isPositive: boolean 
  };
  icon?: React.ReactNode;
  loading?: boolean;
}
```

**Features:**
- Use shadcn Card component
- Show loading skeleton when loading=true
- Display trend with colored arrow (green positive, red negative)
- Animated number transitions (can use CSS or framer-motion)
- Responsive design
- Icon in top-right corner
- Format numbers with commas for thousands
- Color-coded trend indicators:
  - Green: Positive trends (up arrow, text-green-600)
  - Red: Negative trends (down arrow, text-red-600)

**Styling:**
- Match existing admin components style
- Use #5674BC for primary elements
- Support dark mode
- Subtle hover effects

---

### 2. CREATE: `src/hooks/useAdminMetrics.ts`

Create TanStack Query hooks for fetching all admin metrics from backend API:

```typescript
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/axios';

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const { data } = await api.get('/api/admin/metrics/overview');
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Auto-refetch every 5 min
  });
}

export function useRevenueMetrics(period: string = '30d') {
  return useQuery({
    queryKey: ['admin', 'revenue', period],
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/metrics/revenue?period=${period}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUserMetrics(period: string = '30d') {
  return useQuery({
    queryKey: ['admin', 'users', period],
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/metrics/users?period=${period}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSummaryMetrics(period: string = '30d') {
  return useQuery({
    queryKey: ['admin', 'summaries', period],
    queryFn: async () => {
      const { data } = await api.get(`/api/admin/metrics/summaries?period=${period}`);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDownloadMetrics() {
  return useQuery({
    queryKey: ['admin', 'downloads'],
    queryFn: async () => {
      const { data } = await api.get('/api/admin/metrics/downloads');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSupportMetrics() {
  return useQuery({
    queryKey: ['admin', 'support'],
    queryFn: async () => {
      const { data } = await api.get('/api/admin/metrics/support');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin', 'system-health'],
    queryFn: async () => {
      const { data } = await api.get('/api/admin/metrics/system-health');
      return data;
    },
    staleTime: 30 * 1000, // 30 seconds for real-time health monitoring
    refetchInterval: 30 * 1000, // Auto-refetch every 30 seconds
  });
}
```

**Note:** Use the existing `api` instance from `@/lib/axios` which already has auth headers configured.

---

### 3. CREATE: `src/components/admin/AdminOverview.tsx`

Create main overview dashboard with these sections:

**Layout Structure:**

#### Top Row - 4 KPI Cards (Grid: 4 cols desktop, 2 cols tablet, 1 col mobile)
1. **Total Revenue**
   - Show amount in dollars (API returns cents, convert: `$${(cents / 100).toLocaleString()}`)
   - Display MTD comparison
   - Show % change trend (green if positive, red if negative)
   - Icon: DollarSign from lucide-react

2. **Active Users (30d)**
   - Show count with `toLocaleString()`
   - Display growth indicator
   - Icon: Users from lucide-react

3. **Summaries This Month**
   - Show count
   - Display success rate as badge (e.g., "96.5% success")
   - Icon: FileText from lucide-react

4. **Open Support Tickets**
   - Show count
   - Display trend indicator
   - Icon: HeadphonesIcon from lucide-react

#### Second Row - Revenue Chart (Full width)
- **Area Chart** showing last 30 days revenue by day
- Use Recharts `<AreaChart>` component
- Gradient fill (#5674BC with opacity)
- Tooltip showing date and formatted dollar amount
- Format Y-axis values as currency
- Responsive height (300px desktop, 250px mobile)

#### Third Row - 3 Column Grid
1. **Summary Processing Stats** (Bar Chart)
   - Show Success/Error/Processing breakdown
   - Use Recharts `<BarChart>`
   - Color coding: Green (success), Red (error), Blue (processing)

2. **User Growth** (Line Chart)
   - Show new users over last 3 months
   - Use Recharts `<LineChart>`
   - Smooth curve

3. **Downloads by Format** (Pie Chart)
   - Show PDF, DOCX, CSV, TXT breakdown
   - Use Recharts `<PieChart>`
   - Display percentages and counts

#### Bottom Row - System Health (4 cards grid)
- **Queue Status**: Show Queued, Processing, Completed today counts
- **Error Rate**: Show Last 7 days percentage with mini trend
- **Avg Processing Time**: Show minutes with trend indicator
- **Support Resolution Time**: Show hours average

**Implementation Details:**
- Use `useAdminOverview()` hook for data
- Display loading skeletons while fetching (`<Skeleton>` from shadcn/ui)
- Handle errors gracefully with error messages
- All monetary values from API are in cents - convert to dollars
- Format numbers: `toLocaleString()` for commas
- Format percentages: 1 decimal place

---

### 4. CREATE: `src/components/admin/AdminAnalytics.tsx`

Create detailed analytics view with:

#### Header Section
- **Period Selector**: Button group for "7 Days", "30 Days", "90 Days", "All Time"
- **Export CSV Button**: Download all visible data as CSV
- State management for selected period

#### Content (Use shadcn/ui Tabs component)

**Tab 1: Revenue Analytics**
- Use `useRevenueMetrics(period)` hook
- Display metrics:
  - Total Revenue (formatted as currency)
  - ARPU (Average Revenue Per User)
  - Credit Utilization Rate (progress bar)
  - Average Transaction Value
- **Revenue Trend Chart**: Line chart showing daily revenue
- **Top Purchasers Table**: Show top 10 users by total spent
  - Columns: User Name, Total Spent, Number of Purchases
  - Sortable columns
  - Export CSV button

**Tab 2: User Analytics**
- Use `useUserMetrics(period)` hook
- Display metrics:
  - Total Users, Active Users, New Signups
  - Churn Rate, Retention Rate
  - Engagement Score
- **User Growth Chart**: Line chart showing new users over time
- **Users by Company Table**: Show top companies by user count
  - Bar chart visualization
  - Sortable table

**Tab 3: Product Performance**
- Use `useSummaryMetrics(period)` hook
- Display metrics:
  - Total Summaries, Success Rate
  - Average Processing Time
  - Average Pages Per Summary
- **Success/Failure Breakdown**: Pie or bar chart
- **Processing Time Trend**: Line chart
- **Peak Usage Heatmap**: Show summaries by hour of day (0-23)
  - Use Recharts with custom cell colors
  - Tooltip showing count per hour

**Tab 4: Downloads**
- Use `useDownloadMetrics()` hook
- Display metrics:
  - Total Downloads
  - Downloads This Month
  - Average Downloads Per Summary
- **Format Breakdown**: Pie chart (PDF, DOCX, CSV, TXT)
- **Top Downloaded Summaries Table**: Top 10
  - Columns: Summary Title, Download Count
  - Click to view summary (if possible)

**Tab 5: Support**
- Use `useSupportMetrics()` hook
- Display metrics:
  - Open, In Progress, Closed counts
  - Average Response Time (hours)
  - Average Resolution Time (hours)
- **Ticket Volume Chart**: Line chart showing opened vs closed over time
- **Top Issues Table**: Most common subjects
  - Grouped by subject line
  - Show counts

**Common Features for All Tabs:**
- Loading states with skeletons
- Error handling with retry buttons
- Export CSV functionality for all tables
- Responsive design (stack on mobile)

---

### 5. MODIFY: `src/pages/Admin.tsx`

Make these changes to the existing Admin page:

#### Import New Components
```typescript
import { AdminOverview } from "@/components/admin/AdminOverview";
import { AdminAnalytics } from "@/components/admin/AdminAnalytics";
```

#### Change Tabs defaultValue
Find the `<Tabs>` component and change `defaultValue="signups"` to `defaultValue="overview"`

#### Add New Tabs FIRST in TabsList
Add these **before** the existing tabs:
```typescript
<TabsTrigger value="overview">Overview</TabsTrigger>
<TabsTrigger value="analytics">Analytics</TabsTrigger>
```

#### Add TabsContent for New Tabs
Add these **before** the existing TabsContent sections:
```typescript
<TabsContent value="overview">
  <AdminOverview />
</TabsContent>

<TabsContent value="analytics">
  <AdminAnalytics />
</TabsContent>
```

#### Keep ALL Existing Tabs Unchanged
- purchase-dashboard
- purchases
- signups
- downloads
- support
- prompt

---

## Design Requirements

**Color Scheme:**
- Primary: #5674BC
- Success: text-green-600, bg-green-100
- Error: text-red-600, bg-red-100
- Warning: text-yellow-600, bg-yellow-100
- Neutral: text-slate-600, bg-slate-100

**Responsive Design:**
- Mobile (< 768px): Stack all elements, 1 column
- Tablet (768px - 1024px): 2 columns for cards, responsive charts
- Desktop (> 1024px): Full grid layouts (4 cols for KPI cards)

**Loading States:**
- Use shadcn/ui `<Skeleton>` component
- Match dimensions of actual content
- Pulse animation

**Error Handling:**
- Display error message with retry button
- Use shadcn/ui `<Alert>` component
- Console.log errors for debugging

**Charts (Recharts):**
- Import from "recharts"
- Use `<ResponsiveContainer>` wrapper (width="100%" height={300})
- Components: `<AreaChart>`, `<LineChart>`, `<BarChart>`, `<PieChart>`
- Add `<Tooltip>` to all charts
- Format tooltip values (currency, numbers, percentages)
- Use `<XAxis>` and `<YAxis>` with proper labels

**Icons (Lucide React):**
- Import: `import { DollarSign, Users, FileText, TrendingUp, TrendingDown, Download, HeadphonesIcon } from "lucide-react"`
- Size: `className="h-5 w-5"` for KPI cards
- Colors: Match theme colors

**Number Formatting:**
- Currency: `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
- Large numbers: `value.toLocaleString('en-US')`
- Percentages: `${value.toFixed(1)}%`
- Decimals: 1 decimal place for percentages, 2 for currency

**Accessibility:**
- ARIA labels on all interactive elements
- Keyboard navigation support (Tab, Enter, Escape)
- Screen reader friendly
- Color contrast compliance (WCAG AA)
- Focus indicators on buttons and inputs

**Dark Mode:**
- Use Tailwind's dark: prefix
- Test all charts work in dark mode
- Ensure text contrast remains good
- Adapt chart colors for dark backgrounds

---

## Expected API Response Formats

The backend returns these data structures (all amounts in cents):

### /api/admin/metrics/overview
```json
{
  "revenue": {
    "total": 125000,
    "mtd": 15000,
    "last30Days": 45000,
    "growth": 12.5
  },
  "users": {
    "total": 450,
    "active7d": 180,
    "active30d": 320,
    "newThisMonth": 45,
    "growthRate": 8.2
  },
  "summaries": {
    "total": 2500,
    "thisMonth": 340,
    "successRate": 96.5,
    "avgProcessingTime": 3.2
  },
  "support": {
    "openTickets": 12,
    "avgResponseTime": 2.5,
    "avgResolutionTime": 24
  }
}
```

Other endpoints return similar structured JSON with arrays for chart data.

---

## Implementation Checklist

- [ ] Create KPICard component with all features
- [ ] Create useAdminMetrics hook with all 7 query functions
- [ ] Create AdminOverview with 4 sections (KPIs, Charts, System Health)
- [ ] Create AdminAnalytics with 5 tabs (Revenue, Users, Product, Downloads, Support)
- [ ] Modify Admin.tsx to add Overview and Analytics tabs
- [ ] Test all loading states work correctly
- [ ] Test error handling with failed API calls
- [ ] Test responsive design on mobile, tablet, desktop
- [ ] Verify dark mode compatibility on all components
- [ ] Test all charts render correctly
- [ ] Verify number formatting (currency, commas, decimals)
- [ ] Test CSV export functionality
- [ ] Check accessibility (keyboard nav, screen readers)

---

## Style Reference

Match the styling patterns from existing admin components:
- `/loveable/src/components/admin/PurchaseDashboard.tsx` - For chart styling
- `/loveable/src/components/admin/AdminSignups.tsx` - For table and filter patterns
- `/loveable/src/pages/Admin.tsx` - For tab structure

Use existing shadcn/ui components:
- Card, CardHeader, CardTitle, CardContent
- Table, TableHeader, TableBody, TableRow, TableCell
- Button, Tabs, TabsList, TabsTrigger, TabsContent
- Skeleton, Alert, Progress

---

**Generate all components with TypeScript strict mode, proper error handling, loading states, and responsive design. Follow existing code patterns in the admin components directory.**



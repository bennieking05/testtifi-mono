// backend/src/types/adminTypes.ts

export interface OverviewMetrics {
  revenue: {
    total: number;
    mtd: number;
    last30Days: number;
    growth: number;
  };
  users: {
    total: number;
    active7d: number;
    active30d: number;
    newThisMonth: number;
    growthRate: number;
  };
  summaries: {
    total: number;
    thisMonth: number;
    successRate: number;
    avgProcessingTime: number;
  };
  support: {
    openTickets: number;
    avgResponseTime: number;
    avgResolutionTime: number;
  };
}

export interface RevenueMetrics {
  totalRevenue: number;
  arpu: number;
  creditsPurchased: number;
  creditsUsed: number;
  utilizationRate: number;
  avgTransactionValue: number;
  revenueByDay: Array<{ date: string; revenue: number; count: number }>;
  topPurchasers: Array<{ userId: string; userName: string; totalSpent: number }>;
}

export interface UserMetrics {
  totalUsers: number;
  activeUsers: number;
  newSignups: number;
  churnedUsers: number;
  retentionRate: number;
  userGrowthByDay: Array<{ date: string; newUsers: number; totalUsers: number }>;
  usersByCompany: Array<{ company: string; count: number }>;
  engagementScore: number;
}

export interface SummaryMetrics {
  totalSummaries: number;
  successful: number;
  failed: number;
  processing: number;
  successRate: number;
  avgProcessingTime: number;
  avgPagesPerSummary: number;
  totalPagesProcessed: number;
  summariesByDay: Array<{ date: string; count: number; avgTime: number }>;
  summariesByHour: Array<{ hour: number; count: number }>;
  errorTypes: Array<{ error: string; count: number }>;
}

export interface DownloadMetrics {
  totalDownloads: number;
  byFormat: {
    pdf: number;
    docx: number;
    csv: number;
    txt: number;
  };
  downloadsThisMonth: number;
  avgDownloadsPerSummary: number;
  topDownloaded: Array<{ summaryId: string; title: string; downloads: number }>;
  downloadsByDay: Array<{ date: string; count: number }>;
}

export interface SupportMetrics {
  totalTickets: number;
  open: number;
  inProgress: number;
  closed: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  ticketsByDay: Array<{ date: string; opened: number; closed: number }>;
  topIssues: Array<{ subject: string; count: number }>;
}

export interface SystemHealthMetrics {
  queueDepth: number;
  processingJobs: number;
  completedToday: number;
  failedToday: number;
  avgJobTime24h: number;
  errorRate24h: number;
}



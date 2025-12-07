// backend/src/services/metricsService.ts

import { PrismaClient } from "@prisma/client";
import type {
  OverviewMetrics,
  RevenueMetrics,
  UserMetrics,
  SummaryMetrics,
  DownloadMetrics,
  SupportMetrics,
  SystemHealthMetrics,
  ExpiredCreditsSummary,
} from "../types/adminTypes";
import { LEDGER_EXPIRATION_PREFIX } from "../billing/creditExpiration";

const prisma = new PrismaClient();

export class MetricsService {
  // Helper: Get date range
  private getDateRange(period: string): Date {
    const now = new Date();
    switch (period) {
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "30d":
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case "90d":
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(0); // All time
    }
  }

  private getStartOfMonth(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private getStartOfToday(): Date {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // === OVERVIEW METRICS ===
  async getOverviewMetrics(): Promise<OverviewMetrics> {
    const [revenue, users, summaries, support] = await Promise.all([
      this.calculateRevenueOverview(),
      this.calculateUserOverview(),
      this.calculateSummaryOverview(),
      this.calculateSupportOverview(),
    ]);

    return { revenue, users, summaries, support };
  }

  private async calculateRevenueOverview() {
    const [total, mtd, last30Days, previousMonth] = await Promise.all([
      prisma.purchase.aggregate({
        where: { status: "succeeded" },
        _sum: { amountCents: true },
      }),
      prisma.purchase.aggregate({
        where: {
          status: "succeeded",
          createdAt: { gte: this.getStartOfMonth() },
        },
        _sum: { amountCents: true },
      }),
      prisma.purchase.aggregate({
        where: {
          status: "succeeded",
          createdAt: { gte: this.getDateRange("30d") },
        },
        _sum: { amountCents: true },
      }),
      prisma.purchase.aggregate({
        where: {
          status: "succeeded",
          createdAt: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 2)),
            lt: new Date(new Date().setMonth(new Date().getMonth() - 1)),
          },
        },
        _sum: { amountCents: true },
      }),
    ]);

    const totalRevenue = total._sum.amountCents || 0;
    const mtdRevenue = mtd._sum.amountCents || 0;
    const last30DaysRevenue = last30Days._sum.amountCents || 0;
    const previousMonthRevenue = previousMonth._sum.amountCents || 0;

    const growth =
      previousMonthRevenue > 0
        ? ((mtdRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
        : 0;

    return {
      total: totalRevenue,
      mtd: mtdRevenue,
      last30Days: last30DaysRevenue,
      growth: Math.round(growth * 10) / 10,
    };
  }

  private async calculateUserOverview() {
    const [total, active7d, active30d, newThisMonth, previousMonthNew] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          summaryJobs: {
            some: {
              createdAt: { gte: this.getDateRange("7d") },
            },
          },
        },
      }),
      prisma.user.count({
        where: {
          summaryJobs: {
            some: {
              createdAt: { gte: this.getDateRange("30d") },
            },
          },
        },
      }),
      prisma.user.count({
        where: { createdAt: { gte: this.getStartOfMonth() } },
      }),
      prisma.user.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 2)),
            lt: new Date(new Date().setMonth(new Date().getMonth() - 1)),
          },
        },
      }),
    ]);

    const growthRate =
      previousMonthNew > 0
        ? ((newThisMonth - previousMonthNew) / previousMonthNew) * 100
        : 0;

    return {
      total,
      active7d,
      active30d,
      newThisMonth,
      growthRate: Math.round(growthRate * 10) / 10,
    };
  }

  private async calculateSummaryOverview() {
    const [total, thisMonth, stats] = await Promise.all([
      prisma.summaryJob.count(),
      prisma.summaryJob.count({
        where: { createdAt: { gte: this.getStartOfMonth() } },
      }),
      prisma.summaryJob.groupBy({
        by: ["status"],
        where: { createdAt: { gte: this.getStartOfMonth() } },
        _count: true,
      }),
    ]);

    const successful = stats.find((s) => s.status === "complete")?._count || 0;
    const failed = stats.find((s) => s.status === "error")?._count || 0;
    const totalThisMonth = successful + failed;
    const successRate = totalThisMonth > 0 ? (successful / totalThisMonth) * 100 : 0;

    // Calculate average processing time
    const completedJobs = await prisma.summaryJob.findMany({
      where: {
        status: "complete",
        finishedAt: { not: null },
        createdAt: { gte: this.getDateRange("30d") },
      },
      select: { startedAt: true, finishedAt: true },
    });

    const avgTime =
      completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            const duration =
              (job.finishedAt!.getTime() - job.startedAt.getTime()) / 1000 / 60;
            return sum + duration;
          }, 0) / completedJobs.length
        : 0;

    return {
      total,
      thisMonth,
      successRate: Math.round(successRate * 10) / 10,
      avgProcessingTime: Math.round(avgTime * 10) / 10,
    };
  }

  private async calculateSupportOverview() {
    const [openTickets, tickets] = await Promise.all([
      prisma.supportTicket.count({
        where: { status: "OPEN" },
      }),
      prisma.supportTicket.findMany({
        where: {
          replies: { some: {} },
          createdAt: { gte: this.getDateRange("30d") },
        },
        include: {
          replies: {
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      }),
    ]);

    const responseTimes = tickets.map((ticket) => {
      if (ticket.replies.length === 0) return 0;
      return (
        (ticket.replies[0].createdAt.getTime() - ticket.createdAt.getTime()) /
        1000 /
        60 /
        60
      ); // hours
    });

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0;

    // Calculate avg resolution time (only closed tickets)
    const closedTickets = await prisma.supportTicket.findMany({
      where: {
        status: "CLOSED",
        createdAt: { gte: this.getDateRange("30d") },
      },
      select: { createdAt: true, updatedAt: true },
    });

    const resolutionTimes = closedTickets.map(
      (ticket) =>
        (ticket.updatedAt.getTime() - ticket.createdAt.getTime()) / 1000 / 60 / 60
    ); // hours

    const avgResolutionTime =
      resolutionTimes.length > 0
        ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
        : 0;

    return {
      openTickets,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
    };
  }

  // === REVENUE METRICS ===
  async getRevenueMetrics(period: string): Promise<RevenueMetrics> {
    const startDate = this.getDateRange(period);

    const purchases = await prisma.purchase.findMany({
      where: {
        status: "succeeded",
        createdAt: { gte: startDate },
      },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    const totalRevenue = purchases.reduce((sum, p) => sum + p.amountCents, 0);
    const totalUsers = await prisma.user.count();
    const arpu = totalUsers > 0 ? totalRevenue / totalUsers : 0;

    // Credits
    const creditsPurchased = purchases.reduce((sum, p) => sum + p.creditsAdded, 0);
    const creditsUsed = await prisma.ledgerEntry.aggregate({
      where: {
        type: "debit",
        createdAt: { gte: startDate },
      },
      _sum: { credits: true },
    });
    const totalCreditsUsed = Math.abs(creditsUsed._sum.credits || 0);
    const utilizationRate =
      creditsPurchased > 0 ? (totalCreditsUsed / creditsPurchased) * 100 : 0;

    const avgTransactionValue = purchases.length > 0 ? totalRevenue / purchases.length : 0;

    // Revenue by day
    const revenueByDay = purchases.reduce((acc, purchase) => {
      const date = purchase.createdAt.toISOString().split("T")[0];
      if (!acc[date]) {
        acc[date] = { date, revenue: 0, count: 0 };
      }
      acc[date].revenue += purchase.amountCents;
      acc[date].count += 1;
      return acc;
    }, {} as Record<string, { date: string; revenue: number; count: number }>);

    // Top purchasers
    const userPurchases = purchases.reduce((acc, purchase) => {
      const userId = purchase.userId;
      if (!acc[userId]) {
        acc[userId] = {
          userId,
          userName: purchase.user?.name || "Unknown",
          totalSpent: 0,
        };
      }
      acc[userId].totalSpent += purchase.amountCents;
      return acc;
    }, {} as Record<string, { userId: string; userName: string; totalSpent: number }>);

    const topPurchasers = Object.values(userPurchases)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    return {
      totalRevenue,
      arpu: Math.round(arpu),
      creditsPurchased,
      creditsUsed: totalCreditsUsed,
      utilizationRate: Math.round(utilizationRate * 10) / 10,
      avgTransactionValue: Math.round(avgTransactionValue),
      revenueByDay: Object.values(revenueByDay),
      topPurchasers,
    };
  }

  // === USER METRICS ===
  async getUserMetrics(period: string): Promise<UserMetrics> {
    const startDate = this.getDateRange(period);

    const [totalUsers, activeUsers, newSignups, churnedUsers, users] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({
        where: {
          summaryJobs: {
            some: {
              createdAt: { gte: startDate },
            },
          },
        },
      }),
      prisma.user.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.user.count({
        where: {
          summaryJobs: {
            none: {
              createdAt: { gte: this.getDateRange("90d") },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: { createdAt: { gte: startDate } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, companyName: true },
      }),
    ]);

    const retentionRate = totalUsers > 0 ? ((totalUsers - churnedUsers) / totalUsers) * 100 : 0;

    // User growth by day
    const userGrowthByDay = users.reduce((acc, user) => {
      const date = user.createdAt.toISOString().split("T")[0];
      if (!acc[date]) {
        acc[date] = { date, newUsers: 0, totalUsers: 0 };
      }
      acc[date].newUsers += 1;
      return acc;
    }, {} as Record<string, { date: string; newUsers: number; totalUsers: number }>);

    // Calculate cumulative totals
    let cumulative = 0;
    Object.values(userGrowthByDay).forEach((day) => {
      cumulative += day.newUsers;
      day.totalUsers = cumulative;
    });

    // Users by company
    const usersByCompany = users.reduce((acc, user) => {
      const company = user.companyName || "Unknown";
      if (!acc[company]) {
        acc[company] = { company, count: 0 };
      }
      acc[company].count += 1;
      return acc;
    }, {} as Record<string, { company: string; count: number }>);

    // Engagement score (summaries per active user)
    const totalSummaries = await prisma.summaryJob.count({
      where: { createdAt: { gte: startDate } },
    });
    const engagementScore = activeUsers > 0 ? totalSummaries / activeUsers : 0;

    return {
      totalUsers,
      activeUsers,
      newSignups,
      churnedUsers,
      retentionRate: Math.round(retentionRate * 10) / 10,
      userGrowthByDay: Object.values(userGrowthByDay),
      usersByCompany: Object.values(usersByCompany)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      engagementScore: Math.round(engagementScore * 10) / 10,
    };
  }

  // === SUMMARY METRICS ===
  async getSummaryMetrics(period: string): Promise<SummaryMetrics> {
    const startDate = this.getDateRange(period);

    const [totalSummaries, jobs, jobsByHour] = await Promise.all([
      prisma.summaryJob.count(),
      prisma.summaryJob.findMany({
        where: { createdAt: { gte: startDate } },
        select: {
          status: true,
          createdAt: true,
          startedAt: true,
          finishedAt: true,
          totalPages: true,
          error: true,
        },
      }),
      prisma.summaryJob.findMany({
        where: { createdAt: { gte: startDate } },
        select: { createdAt: true },
      }),
    ]);

    const successful = jobs.filter((j) => j.status === "complete").length;
    const failed = jobs.filter((j) => j.status === "error").length;
    const processing = jobs.filter((j) => j.status === "processing" || j.status === "queued").length;
    const successRate = jobs.length > 0 ? (successful / jobs.length) * 100 : 0;

    // Avg processing time
    const completedJobs = jobs.filter((j) => j.status === "complete" && j.finishedAt);
    const avgProcessingTime =
      completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            const duration = (job.finishedAt!.getTime() - job.startedAt.getTime()) / 1000 / 60;
            return sum + duration;
          }, 0) / completedJobs.length
        : 0;

    // Avg pages per summary
    const jobsWithPages = jobs.filter((j) => j.totalPages > 0);
    const avgPagesPerSummary =
      jobsWithPages.length > 0
        ? jobsWithPages.reduce((sum, j) => sum + j.totalPages, 0) / jobsWithPages.length
        : 0;

    const totalPagesProcessed = jobs.reduce((sum, j) => sum + j.totalPages, 0);

    // Summaries by day
    const summariesByDay = jobs.reduce((acc, job) => {
      const date = job.createdAt.toISOString().split("T")[0];
      if (!acc[date]) {
        acc[date] = { date, count: 0, totalTime: 0, timeCount: 0, avgTime: 0 };
      }
      acc[date].count += 1;
      if (job.status === "complete" && job.finishedAt) {
        const duration = (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000 / 60;
        acc[date].totalTime += duration;
        acc[date].timeCount += 1;
      }
      return acc;
    }, {} as Record<string, { date: string; count: number; totalTime: number; timeCount: number; avgTime: number }>);

    Object.values(summariesByDay).forEach((day) => {
      day.avgTime = day.timeCount > 0 ? day.totalTime / day.timeCount : 0;
    });

    // Summaries by hour
    const hourCounts = new Array(24).fill(0);
    jobsByHour.forEach((job) => {
      const hour = job.createdAt.getHours();
      hourCounts[hour] += 1;
    });
    const summariesByHourArray = hourCounts.map((count, hour) => ({ hour, count }));

    // Error types
    const errorTypes = jobs
      .filter((j) => j.status === "error" && j.error)
      .reduce((acc, job) => {
        const error = job.error || "Unknown error";
        if (!acc[error]) {
          acc[error] = { error, count: 0 };
        }
        acc[error].count += 1;
        return acc;
      }, {} as Record<string, { error: string; count: number }>);

    return {
      totalSummaries,
      successful,
      failed,
      processing,
      successRate: Math.round(successRate * 10) / 10,
      avgProcessingTime: Math.round(avgProcessingTime * 10) / 10,
      avgPagesPerSummary: Math.round(avgPagesPerSummary * 10) / 10,
      totalPagesProcessed,
      summariesByDay: Object.values(summariesByDay).map((day) => ({
        date: day.date,
        count: day.count,
        avgTime: Math.round(day.avgTime * 10) / 10,
      })),
      summariesByHour: summariesByHourArray,
      errorTypes: Object.values(errorTypes).sort((a, b) => b.count - a.count).slice(0, 10),
    };
  }

  // === DOWNLOAD METRICS ===
  async getDownloadMetrics(): Promise<DownloadMetrics> {
    const startOfMonth = this.getStartOfMonth();

    const [totalDownloads, downloads, downloadsThisMonth, summaries] = await Promise.all([
      prisma.downloadHistory.count(),
      prisma.downloadHistory.findMany({
        select: {
          id: true,
          format: true,
          createdAt: true,
          fileId: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          file: { select: { title: true } },
        },
      }),
      prisma.downloadHistory.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      prisma.file.findMany({
        select: { id: true, title: true },
      }),
    ]);

    // Downloads by format
    const formatCounts = downloads.reduce(
      (acc, d) => {
        const format = d.format.toLowerCase();
        if (format in acc) {
          acc[format as keyof typeof acc] += 1;
        }
        return acc;
      },
      { pdf: 0, docx: 0, csv: 0, txt: 0 }
    );

    // Average downloads per summary
    const avgDownloadsPerSummary = summaries.length > 0 ? totalDownloads / summaries.length : 0;

    // Top downloaded
    const downloadsByFile = downloads.reduce((acc, d) => {
      if (!acc[d.fileId]) {
        acc[d.fileId] = { fileId: d.fileId, title: d.file?.title || "Unknown", count: 0 };
      }
      acc[d.fileId].count += 1;
      return acc;
    }, {} as Record<string, { fileId: string; title: string; count: number }>);

    const topDownloaded = Object.values(downloadsByFile)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((item) => ({
        summaryId: item.fileId,
        title: item.title,
        downloads: item.count,
      }));

    // Downloads by day
    const downloadsByDay = downloads.reduce((acc, d) => {
      const date = d.createdAt.toISOString().split("T")[0];
      if (!acc[date]) {
        acc[date] = { date, count: 0 };
      }
      acc[date].count += 1;
      return acc;
    }, {} as Record<string, { date: string; count: number }>);

    const recentDownloads = downloads
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((d) => ({
        id: d.id,
        summaryId: d.fileId,
        title: d.file?.title || "Unknown",
        format: d.format.toUpperCase(),
        downloadedAt: d.createdAt.toISOString(),
        userName: d.user?.name ?? null,
        userEmail: d.user?.email ?? null,
      }));

    return {
      totalDownloads,
      byFormat: formatCounts,
      downloadsThisMonth,
      avgDownloadsPerSummary: Math.round(avgDownloadsPerSummary * 10) / 10,
      topDownloaded,
      downloadsByDay: Object.values(downloadsByDay),
      recentDownloads,
    };
  }

  // === SUPPORT METRICS ===
  async getSupportMetrics(): Promise<SupportMetrics> {
    const last30Days = this.getDateRange("30d");

    const [totalTickets, tickets, ticketsWithReplies] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.findMany({
        where: { createdAt: { gte: last30Days } },
        select: { status: true, createdAt: true, subject: true },
      }),
      prisma.supportTicket.findMany({
        where: {
          replies: { some: {} },
          createdAt: { gte: last30Days },
        },
        include: {
          replies: {
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      }),
    ]);

    const open = tickets.filter((t) => t.status === "OPEN").length;
    const inProgress = tickets.filter((t) => t.status === "IN_PROGRESS").length;
    const closed = tickets.filter((t) => t.status === "CLOSED").length;

    // Avg response time
    const responseTimes = ticketsWithReplies.map((ticket) => {
      if (ticket.replies.length === 0) return 0;
      return (
        (ticket.replies[0].createdAt.getTime() - ticket.createdAt.getTime()) / 1000 / 60 / 60
      );
    });

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
        : 0;

    // Avg resolution time
    const closedTickets = await prisma.supportTicket.findMany({
      where: {
        status: "CLOSED",
        createdAt: { gte: last30Days },
      },
      select: { createdAt: true, updatedAt: true },
    });

    const resolutionTimes = closedTickets.map(
      (ticket) =>
        (ticket.updatedAt.getTime() - ticket.createdAt.getTime()) / 1000 / 60 / 60
    );

    const avgResolutionTime =
      resolutionTimes.length > 0
        ? resolutionTimes.reduce((sum, time) => sum + time, 0) / resolutionTimes.length
        : 0;

    // Tickets by day
    const ticketsByDay = tickets.reduce((acc, ticket) => {
      const date = ticket.createdAt.toISOString().split("T")[0];
      if (!acc[date]) {
        acc[date] = { date, opened: 0, closed: 0 };
      }
      acc[date].opened += 1;
      if (ticket.status === "CLOSED") {
        acc[date].closed += 1;
      }
      return acc;
    }, {} as Record<string, { date: string; opened: number; closed: number }>);

    // Top issues
    const topIssues = tickets.reduce((acc, ticket) => {
      const subject = ticket.subject || "No subject";
      if (!acc[subject]) {
        acc[subject] = { subject, count: 0 };
      }
      acc[subject].count += 1;
      return acc;
    }, {} as Record<string, { subject: string; count: number }>);

    return {
      totalTickets,
      open,
      inProgress,
      closed,
      avgResponseTime: Math.round(avgResponseTime * 10) / 10,
      avgResolutionTime: Math.round(avgResolutionTime * 10) / 10,
      ticketsByDay: Object.values(ticketsByDay),
      topIssues: Object.values(topIssues)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  // === SYSTEM HEALTH METRICS ===
  async getSystemHealthMetrics(): Promise<SystemHealthMetrics> {
    const startOfToday = this.getStartOfToday();
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [queuedJobs, processingJobs, completedToday, failedToday, recentJobs] =
      await Promise.all([
        prisma.summaryJob.count({
          where: { status: "queued" },
        }),
        prisma.summaryJob.count({
          where: { status: "processing" },
        }),
        prisma.summaryJob.count({
          where: {
            status: "complete",
            finishedAt: { gte: startOfToday },
          },
        }),
        prisma.summaryJob.count({
          where: {
            status: "error",
            createdAt: { gte: startOfToday },
          },
        }),
        prisma.summaryJob.findMany({
          where: {
            createdAt: { gte: last24Hours },
          },
          select: {
            status: true,
            startedAt: true,
            finishedAt: true,
          },
        }),
      ]);

    // Calculate avg job time (last 24h)
    const completedJobs = recentJobs.filter(
      (j) => j.status === "complete" && j.finishedAt
    );
    const avgJobTime24h =
      completedJobs.length > 0
        ? completedJobs.reduce((sum, job) => {
            const duration =
              (job.finishedAt!.getTime() - job.startedAt.getTime()) / 1000 / 60;
            return sum + duration;
          }, 0) / completedJobs.length
        : 0;

    // Calculate error rate (last 24h)
    const totalJobs24h = recentJobs.length;
    const failedJobs24h = recentJobs.filter((j) => j.status === "error").length;
    const errorRate24h = totalJobs24h > 0 ? (failedJobs24h / totalJobs24h) * 100 : 0;

    return {
      queueDepth: queuedJobs,
      processingJobs,
      completedToday,
      failedToday,
      avgJobTime24h: Math.round(avgJobTime24h * 10) / 10,
      errorRate24h: Math.round(errorRate24h * 10) / 10,
    };
  }

  async getExpiredCreditSummary(): Promise<ExpiredCreditsSummary> {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        type: "credit",
        credits: { lt: 0 },
        idempotencyKey: { startsWith: LEDGER_EXPIRATION_PREFIX },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        purchase: {
          select: {
            id: true,
            createdAt: true,
            stripePaymentIntentId: true,
          },
        },
      },
    });

    const totalExpired = entries.reduce(
      (sum, entry) => sum + Math.abs(entry.credits),
      0
    );

    const byUserMap = new Map<
      string,
      {
        userId: string;
        name: string | null;
        email: string;
        creditsExpired: number;
        lastExpiredAt: string;
      }
    >();

    for (const entry of entries) {
      const userId = entry.userId;
      const amount = Math.abs(entry.credits);
      const lastExpiredAt = entry.createdAt.toISOString();
      const existing = byUserMap.get(userId);

      if (existing) {
        existing.creditsExpired += amount;
        if (lastExpiredAt > existing.lastExpiredAt) {
          existing.lastExpiredAt = lastExpiredAt;
        }
      } else {
        byUserMap.set(userId, {
          userId,
          name: entry.user?.name ?? null,
          email: entry.user?.email ?? "",
          creditsExpired: amount,
          lastExpiredAt,
        });
      }
    }

    const topUsers = Array.from(byUserMap.values())
      .sort((a, b) => b.creditsExpired - a.creditsExpired)
      .slice(0, 25);

    const recent = entries.slice(0, 50).map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      name: entry.user?.name ?? null,
      email: entry.user?.email ?? "",
      creditsExpired: Math.abs(entry.credits),
      expiredAt: entry.createdAt.toISOString(),
      purchaseId: entry.purchaseId ?? null,
      purchaseDate: entry.purchase?.createdAt?.toISOString() ?? null,
      stripePaymentIntentId: entry.purchase?.stripePaymentIntentId ?? null,
    }));

    return {
      totalExpired,
      topUsers,
      recent,
    };
  }
}

export default new MetricsService();



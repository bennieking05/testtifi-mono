// src/utils/adminNotifications.ts
// Admin notification utilities for judge failures and other alerts

import axios from "axios";

export interface AdminAlert {
  jobId: string;
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Send an admin notification for judge failures or other alerts.
 * - Always logs to Cloud Logging (console.warn/console.error)
 * - Optionally sends to Slack webhook if configured
 */
export async function sendAdminAlert(alert: AdminAlert): Promise<void> {
  const { jobId, severity, title, message, details } = alert;
  const timestamp = new Date().toISOString();

  // Always log to Cloud Logging
  const logFn = severity === "error" ? console.error : console.warn;
  logFn(`[ADMIN ALERT] [${severity.toUpperCase()}] ${title}`, {
    jobId,
    message,
    details,
    timestamp,
  });

  // Send to Slack webhook if configured
  const slackWebhookUrl = process.env.ADMIN_SLACK_WEBHOOK_URL;
  if (slackWebhookUrl) {
    try {
      await axios.post(
        slackWebhookUrl,
        {
          text: `*${getEmoji(severity)} ${title}*`,
          blocks: [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `${getEmoji(severity)} ${title}`,
                emoji: true,
              },
            },
            {
              type: "section",
              fields: [
                {
                  type: "mrkdwn",
                  text: `*Job ID:*\n\`${jobId}\``,
                },
                {
                  type: "mrkdwn",
                  text: `*Severity:*\n${severity.toUpperCase()}`,
                },
              ],
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: message,
              },
            },
            ...(details
              ? [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*Details:*\n\`\`\`${JSON.stringify(details, null, 2)}\`\`\``,
                    },
                  },
                ]
              : []),
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `Timestamp: ${timestamp}`,
                },
              ],
            },
          ],
        },
        { timeout: 5000 }
      );
    } catch (err: any) {
      console.warn(
        `[AdminNotification] Failed to send Slack alert: ${err?.message || err}`
      );
    }
  }

  // Send to generic webhook if configured (for other integrations)
  const genericWebhookUrl = process.env.ADMIN_WEBHOOK_URL;
  if (genericWebhookUrl) {
    try {
      await axios.post(
        genericWebhookUrl,
        {
          type: "admin_alert",
          jobId,
          severity,
          title,
          message,
          details,
          timestamp,
        },
        { timeout: 5000 }
      );
    } catch (err: any) {
      console.warn(
        `[AdminNotification] Failed to send webhook alert: ${err?.message || err}`
      );
    }
  }
}

function getEmoji(severity: AdminAlert["severity"]): string {
  switch (severity) {
    case "error":
      return "🚨";
    case "warning":
      return "⚠️";
    case "info":
    default:
      return "ℹ️";
  }
}

/**
 * Helper to send a judge failure alert
 */
export async function sendJudgeFailureAlert(
  jobId: string,
  judgeResults: {
    allPassed: boolean;
    judges: Array<{
      name: string;
      passed: boolean;
      warnings: string[];
      instructions: string[];
    }>;
  }
): Promise<void> {
  if (judgeResults.allPassed) return;

  const failedJudges = judgeResults.judges.filter((j) => !j.passed);
  const warningJudges = judgeResults.judges.filter(
    (j) => j.passed && j.warnings.length > 0
  );

  let message = "";
  if (failedJudges.length > 0) {
    message += `*Failed Judges:*\n${failedJudges
      .map((j) => `• ${j.name}: ${j.warnings.join("; ")}`)
      .join("\n")}\n\n`;
  }
  if (warningJudges.length > 0) {
    message += `*Warnings:*\n${warningJudges
      .map((j) => `• ${j.name}: ${j.warnings.join("; ")}`)
      .join("\n")}`;
  }

  await sendAdminAlert({
    jobId,
    severity: failedJudges.length > 0 ? "warning" : "info",
    title: `Summary Validation ${failedJudges.length > 0 ? "Failed" : "Warnings"}`,
    message: message.trim(),
    details: {
      failedCount: failedJudges.length,
      warningCount: warningJudges.length,
    },
  });
}





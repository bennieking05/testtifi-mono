import { EmailAttachment, sendEmail } from "../lib/sendEmail";
import { loadLightLogo } from "./logo";
import { renderEmailShell } from "./emailTheme";
import {
  DocumentData,
  JobData,
  generateDocxBuffer,
  generatePdfBuffer,
} from "./generateDocuments";

const MAX_EMAIL_BYTES = 24 * 1024 * 1024; // keep under Gmail 25MB

const sanitizeFilenameBase = (value: string) =>
  value
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "summary";

export interface SummaryEmailParams {
  jobId?: string;
  userEmail: string;
  userName: string;
  displayTitle: string;
  dashboardUrl: string;
  jobData: JobData;
  documentData: DocumentData;
  summaryContent: string;
  includeAttachments?: boolean;
}

export interface SummaryEmailResult {
  attachmentCount: number;
}

export async function sendSummaryReadyEmail(
  params: SummaryEmailParams
): Promise<SummaryEmailResult> {
  const {
    jobId,
    userEmail,
    userName,
    displayTitle,
    dashboardUrl,
    jobData,
    documentData,
    summaryContent,
    includeAttachments = true,
  } = params;

  const attachments: EmailAttachment[] = [];

  if (includeAttachments) {
    try {
      const baseName = sanitizeFilenameBase(displayTitle);
      const docxBuffer = await generateDocxBuffer(jobData, documentData, summaryContent);
      const pdfBuffer = await generatePdfBuffer(jobData, documentData, summaryContent);
      const totalBytes = docxBuffer.length + pdfBuffer.length;

      if (totalBytes <= MAX_EMAIL_BYTES) {
        attachments.push(
          {
            content: docxBuffer.toString("base64"),
            filename: `${baseName}.docx`,
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          },
          {
            content: pdfBuffer.toString("base64"),
            filename: `${baseName}.pdf`,
            type: "application/pdf",
          }
        );
      } else {
        console.warn(
          jobId
            ? `[${jobId}] ⚠️ Attachments too large (${totalBytes} bytes). Sending email without attachments.`
            : `⚠️ Attachments too large (${totalBytes} bytes). Sending email without attachments.`
        );
      }
    } catch (err) {
      console.warn(
        jobId
          ? `[${jobId}] ⚠️ Failed to generate document attachments:`
          : "⚠️ Failed to generate document attachments:",
        err
      );
    }
  }

  const subject = `Your Deposition Summary Is Ready`;
  const logoLight = loadLightLogo();
  const logoCid = "logo_light@testifi.ai";
  const inlineLogoLight: EmailAttachment = {
    content: logoLight.base64,
    filename: "logo-light.png",
    type: logoLight.mime,
    disposition: "inline",
    contentId: logoCid,
  };

  const retentionBoxStyle =
    "margin-top:24px;padding:16px;background-color:#fff3cd;border:1px solid #ffe58f;border-left:4px solid #ffc107;border-radius:6px;color:#5c3d00;";
  const retentionHeadingStyle = "margin:0 0 8px 0;color:#5c3d00;font-weight:600;";
  const retentionBodyStyle = "margin:0;color:#5c3d00;";

  const attachmentsCopy =
    attachments.length > 0
      ? `<p style="text-align: center;color:#666; font-size:14px;">Your summary is attached to this email in Word (DOCX) and PDF formats.</p>`
      : "";

  const bodyHtml = `
    <h2>Your Deposition Summary Is Ready</h2>
    <p>Hello ${userName},</p>
    <p>Great news — the summary you requested for <strong>${displayTitle}</strong> is now complete. Click the button below to return to your dashboard and review it for the next 3 days. The summary will be automatically deleted after 3 days.</p>
    <div class="cta-wrap">
      <a href="${dashboardUrl}" class="btn">View on Dashboard</a>
    </div>
    ${attachmentsCopy}
    <div class="notice" style="${retentionBoxStyle}">
      <p style="${retentionHeadingStyle}"><strong>Important:</strong> Summary Retention Policy</p>
      <p style="${retentionBodyStyle}">Summaries older than 3 days will be automatically deleted from the platform and the content will be irretrievable. Please download and save your summary files for your records.</p>
    </div>
    <p>Need help or have questions? Reply to this email and our support team will be happy to assist.</p>
  `;

  const html = renderEmailShell({
    title: "Deposition Summary Ready",
    bodyHtml,
    theme: (process.env.EMAIL_THEME as any) || "auto",
    logoCid,
  });

  const text = `Hello ${userName},

Great news — the summary you requested for ${displayTitle} is now complete. Click the link below to return to your dashboard and review it for the next 3 days. The summary will be automatically deleted after 3 days.

${dashboardUrl}

${attachments.length > 0 ? "Your summary is attached to this email in Word (DOCX) and PDF formats.\n\n" : ""}Important: Summary Retention Policy
Summaries older than 3 days will be automatically deleted from the platform and the content will be irretrievable. Please download and save your summary files for your records.

Need help or have questions? Reply to this email and our support team will be happy to assist.

© ${new Date().getFullYear()} Testifi AI. All rights reserved.
You're receiving this because you have an account on Testifi AI.`;

  await sendEmail(userEmail, subject, text, html, [inlineLogoLight, ...attachments]);

  return { attachmentCount: attachments.length };
}



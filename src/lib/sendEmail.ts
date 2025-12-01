import sgMail, { MailDataRequired } from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();
const senderEmail = process.env.EMAIL_USER!;
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const MAX_TOTAL_ATTACHMENT_BYTES = 24 * 1024 * 1024; // 24MB safe cap

function estimateBase64Bytes(b64: string | undefined): number {
  if (!b64) return 0;
  const len = b64.length;
  let pad = 0;
  if (b64.endsWith("==")) pad = 2;
  else if (b64.endsWith("=")) pad = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - pad);
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface EmailAttachment {
  content: string; // base64 encoded
  filename: string;
  type?: string;
  disposition?: string;
  contentId?: string;
}

interface SendEmailOptions {
  disableTextFallback?: boolean;
}

export async function sendEmail(
  to: string,
  subject: string,
  text?: string,
  html?: string,
  attachments?: EmailAttachment[],
  options?: SendEmailOptions
) {
  const trimmedText = text?.trim();
  const fallbackText =
    trimmedText ||
    (options?.disableTextFallback ? "" : html ? stripHtml(html) : "No content");
  const shouldIncludeText =
    options?.disableTextFallback ? !!trimmedText : true;

  // Prepare attachments with sensible defaults
  const prepared = (attachments ?? []).map((att) => {
    const isInline = !!att.contentId;
    const disposition = att.disposition ?? (isInline ? "inline" : "attachment");
    const bytes = estimateBase64Bytes(att.content);
    return {
      isInline,
      bytes,
      // Shape expected by SendGrid
      api: {
        content: att.content,
        filename: att.filename,
        type: att.type || (isInline ? "image/png" : "application/octet-stream"),
        disposition,
        // SendGrid expects snake_case for inline CID
        // @ts-ignore
        content_id: att.contentId,
      },
    };
  });

  const inlineBytes = prepared.filter((p) => p.isInline).reduce((n, p) => n + p.bytes, 0);
  const fileBytes = prepared.filter((p) => !p.isInline).reduce((n, p) => n + p.bytes, 0);
  const totalBytes = inlineBytes + fileBytes;

  // If total attachments too large, drop file attachments (keep inline logo)
  let finalAttachments = prepared.map((p) => p.api);
  let attachmentsTrimmed = false;
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    attachmentsTrimmed = true;
    finalAttachments = prepared.filter((p) => p.isInline).map((p) => p.api);
  }

  const msgContent: Partial<MailDataRequired> = {};
  if (html) {
    msgContent.html = html.trim();
  }
  if (shouldIncludeText && fallbackText) {
    msgContent.text = fallbackText;
  } else if (!html) {
    msgContent.text = trimmedText || "No content";
  }

  const msg: MailDataRequired = {
    to,
    from: senderEmail,
    subject,
    ...msgContent,
    ...(finalAttachments.length > 0 ? { attachments: finalAttachments } : {}),
  } as MailDataRequired;

  try {
    const cidAttachments = (attachments ?? [])
      .filter((a) => !!a.contentId)
      .map((a) => a.contentId);
    console.log("📧 Sending email with payload:", {
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      hasHtml: !!msg.html,
      htmlLength: msg.html?.length || 0,
      hasText: !!msg.text,
      textLength: msg.text?.length || 0,
      textPreview: msg.text?.slice(0, 100) + "...",
      attachmentsRequested: attachments?.length || 0,
      attachmentsSent: finalAttachments.length,
      inlineCids: cidAttachments,
      attachmentsBytes: {
        inline: inlineBytes,
        files: fileBytes,
        total: totalBytes,
        trimmed: attachmentsTrimmed,
        max: MAX_TOTAL_ATTACHMENT_BYTES,
      },
    });

    await sgMail.send(msg);
    console.log(
      `✉️  Email sent to ${to}: "${subject}"${msg.html ? " (HTML)" : " (text only)"}${
        finalAttachments.length ? ` with ${finalAttachments.length} attachment(s)` : ""
      }`
    );
  } catch (error: any) {
    if (error?.response?.body?.errors) {
      console.error(
        "❌ SendGrid Error Details:",
        JSON.stringify(error.response.body.errors, null, 2)
      );
      console.error("❌ Full Email Payload:", JSON.stringify(msg, null, 2));
    } else {
      console.error("❌ Unknown SendGrid Error:", error.message || error);
    }
    throw error;
  }
}

import sgMail, { MailDataRequired } from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();
const senderEmail = process.env.EMAIL_USER!;
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

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
}

export async function sendEmail(
  to: string,
  subject: string,
  text?: string,
  html?: string,
  attachments?: EmailAttachment[]
) {
  const fallbackText = text?.trim() || (html ? stripHtml(html) : "No content");

  const msg: MailDataRequired = {
    to,
    from: senderEmail,
    subject,
    // Always include HTML if provided, and include text as fallback
    // SendGrid will use HTML for clients that support it, text for others
    ...(html ? { html: html.trim(), text: fallbackText } : { text: fallbackText }),
    ...(attachments && attachments.length > 0
      ? {
          attachments: attachments.map((att) => ({
            content: att.content,
            filename: att.filename,
            type: att.type || "application/octet-stream",
            disposition: att.disposition || "attachment",
          })),
        }
      : {}),
  };

  try {
    console.log("📧 Sending email with payload:", {
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      hasHtml: !!msg.html,
      htmlLength: msg.html?.length || 0,
      hasText: !!msg.text,
      textLength: msg.text?.length || 0,
      textPreview: msg.text?.slice(0, 100) + "...",
      attachments: attachments?.length || 0,
    });

    await sgMail.send(msg);
    console.log(`✉️  Email sent to ${to}: "${subject}"${msg.html ? " (HTML)" : " (text only)"}${attachments?.length ? ` with ${attachments.length} attachment(s)` : ""}`);
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

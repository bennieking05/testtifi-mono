import sgMail, { MailDataRequired, AttachmentData } from "@sendgrid/mail";
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
    text: fallbackText,
    ...(html ? { html: html.trim() } : {}),
    ...(attachments && attachments.length > 0
      ? {
          attachments: attachments.map((att) => ({
            content: att.content,
            filename: att.filename,
            type: att.type || "application/octet-stream",
            disposition: att.disposition || "attachment",
          })) as AttachmentData[],
        }
      : {}),
  };

  try {
    console.log("📧 Sending email with payload:", {
      to: msg.to,
      from: msg.from,
      subject: msg.subject,
      text: msg.text?.slice(0, 100) + "...",
      attachments: attachments?.length || 0,
    });

    await sgMail.send(msg);
    console.log(`✉️  Email sent to ${to}: "${subject}"${attachments?.length ? ` with ${attachments.length} attachment(s)` : ""}`);
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

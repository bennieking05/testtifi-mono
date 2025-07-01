// ─── src/lib/sendEmail.ts ───────────────────────────────────────────────
import sgMail, { MailDataRequired } from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();
const senderEmail = process.env.EMAIL_USER!;
sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
) {
  const msg: MailDataRequired = {
    to,
    from: senderEmail,
    subject,
    text: text.trim(),
    html: html?.trim(),
  };
  await sgMail.send(msg);
  console.log(`✉️  Email sent to ${to}: "${subject}"`);
}

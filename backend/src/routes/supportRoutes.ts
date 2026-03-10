// src/routes/supportRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient, SupportStatus, ReplyAuthor } from "@prisma/client";
import {
  authenticateToken,
  requireAdmin,
  AuthRequest,
} from "../middlewares/authMiddleware";
import { optionalAuth } from "../middlewares/authMiddleware";
import { sendEmail } from "../controllers/authController";

const prisma = new PrismaClient();
const router = express.Router();

/* ───────────── POST /api/support ───────────── */
router.post(
  "/",
  optionalAuth,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { name, email, subject, message } = req.body as Record<
      string,
      string
    >;

    if (!name || !email || !subject || !message) {
      res.status(400).json({ error: "All fields are required." });
      return;
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.user?.userId ?? null,
        name,
        email,
        subject,
        message,
      },
    });

    // notify admins (fire‑and‑forget)
    prisma.user
      .findMany({ where: { role: "admin" }, select: { email: true } })
      .then((admins) => {
        if (!admins.length) return;
        return sendEmail(
          admins.map((a) => a.email).join(","),
          `🆘 New support ticket: ${subject}`,
          `${name} <${email}>\n\n${message}`,
          `<p><b>Name:</b> ${name}<br/><b>Email:</b> ${email}</p>
           <p><b>Subject:</b> ${subject}</p>
           <p>${message.replace(/\n/g, "<br/>")}</p>`
        );
      })
      .catch(console.error);

    res.json({ message: "Support request submitted", ticketId: ticket.id });
  }
);

/* ───────────── GET /api/support (admin) ───────────── */
router.get(
  "/",
  authenticateToken,
  requireAdmin,
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        replies: true,
        user: {
          select: { name: true },
        },
      },
    });

    res.json(
      tickets.map((t) => ({
        id: t.id,
        user: t.user?.name ?? t.name, // now t.user exists
        email: t.email,
        subject: t.subject,
        createdAt: t.createdAt,
        status: t.status.toLowerCase() as "open" | "in_progress" | "closed",
        source: "Support Request" as const,
        message: t.message,
        responses: t.replies.map((r) => ({
          from: r.from,
          date: r.createdAt,
          message: r.message,
        })),
      }))
    );
  }
);

/* ───────────── PATCH /api/support/:id (status) ───────────── */
router.patch(
  "/:id",
  authenticateToken,
  requireAdmin,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { status } = req.body as { status: SupportStatus };
    if (!Object.values(SupportStatus).includes(status)) {
      res.status(400).json({ error: "Bad status" });
      return;
    }

    const updated = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status },
    });

    res.json(updated);
  }
);

/* ───────────── POST /api/support/:id/reply ───────────── */
router.post(
  "/:id/reply",
  authenticateToken,
  requireAdmin,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const { message } = req.body as { message: string };
    if (!message?.trim()) {
      res.status(400).json({ error: "Message required" });
      return;
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: req.params.id },
      select: { email: true, name: true, subject: true },
    });
    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    await prisma.supportReply.create({
      data: {
        ticketId: req.params.id,
        from: ReplyAuthor.support,
        message: message.trim(),
      },
    });

    // send e‑mail
    sendEmail(
      ticket.email,
      `Re: ${ticket.subject}`,
      message,
      `<p>${message.replace(/\n/g, "<br/>")}</p>`
    ).catch(console.error);

    res.json({ ok: true });
  }
);

export default router;

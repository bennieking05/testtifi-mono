import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import sgMail, { MailDataRequired } from "@sendgrid/mail";
import dotenv from "dotenv";
import { fillTemplate } from "../utils/emailTemplate";

dotenv.config();

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET as string;
const senderEmail = process.env.EMAIL_USER ?? "admin@testifi.ai";

if (!process.env.EMAIL_USER) {
  console.warn(
    "[authController] EMAIL_USER not set – using admin@testifi.ai as fallback"
  );
}

const sendgridApiKey = process.env.SENDGRID_API_KEY;
if (!sendgridApiKey) {
  console.warn("[authController] SENDGRID_API_KEY is not configured – transactional emails will fail.");
} else {
  sgMail.setApiKey(sendgridApiKey);
}
const frontendUrl = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

/* ----------------------------------------------------------------------- */
/*                        SHARED  –  EMAIL HELPER                          */
/* ----------------------------------------------------------------------- */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html: string
) {
  const msg: MailDataRequired = {
    to,
    from: senderEmail,
    subject,
    text: text?.trim() || "This is a transactional email from Testifi AI.",
    html: html?.trim() || undefined,
  };
  await sgMail.send(msg);
  console.log(`Email sent → ${to} : "${subject}"`);
}

/* ----------------------------------------------------------------------- */
/*                               REGISTER USER                             */
/* ----------------------------------------------------------------------- */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { email, password, name, companyName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name, companyName },
    });

    const registrationEmail = await prisma.email.findUnique({
      where: { id: 1 },
    });

    if (registrationEmail) {
      const html = fillTemplate(registrationEmail.body, {
        name: user.name ?? user.email,
        dashboard_link: `${frontendUrl}/dashboard`,
      });

      await sendEmail(
        user.email,
        registrationEmail.subject,
        "Welcome to Testifi AI! Your journey starts here.",
        html
      );
    }

    res
      .status(201)
      .json({ message: "User registered successfully", userId: user.id });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------------------------------------------------- */
/*                       FORGOT‑PASSWORD (SendGrid)                        */
/* ----------------------------------------------------------------------- */
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const resetToken = Math.random().toString(36).substring(2);
    const resetTokenExp = new Date(Date.now() + 3_600_000); // 1 h

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExp },
    });

    const resetLink = `${frontendUrl}/reset-password/${resetToken}`;
    const fpTemplate = await prisma.email.findUnique({ where: { id: 2 } });

    if (fpTemplate) {
      const html = fillTemplate(fpTemplate.body, {
        name: user.name ?? user.email,
        reset_link: resetLink,
      });
      await sendEmail(email, fpTemplate.subject, "", html);
    } else {
      await sendEmail(
        email,
        "Password Reset",
        `Click the link to reset your password: ${resetLink}`,
        `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`
      );
    }

    res.json({ message: "Password reset link sent to email" });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------------------------------------------------- */
/*                       GET EMAIL BY RESET TOKEN                          */
/* ----------------------------------------------------------------------- */
export const getResetEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token = req.query.token;
    if (Array.isArray(token)) token = token[0];

    if (!token || typeof token !== "string") {
      res.status(400).json({ error: "Missing or invalid token" });
      return;
    }

    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExp: { gt: new Date() } },
      select: { email: true },
    });

    if (!user) {
      res.status(404).json({ error: "Invalid or expired token" });
      return;
    }

    res.json({ email: user.email });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------------------------------------------------- */
/*                          RESET PASSWORD FLOW                            */
/* ----------------------------------------------------------------------- */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, newPassword } = req.body;

    const user = await prisma.user.findFirst({
      where: { resetToken: token, resetTokenExp: { gt: new Date() } },
    });
    if (!user) {
      res.status(400).json({ error: "Invalid or expired token" });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, resetToken: null, resetTokenExp: null },
    });

    const confTemplate = await prisma.email.findUnique({ where: { id: 3 } });
    if (confTemplate) {
      const html = fillTemplate(confTemplate.body, {
        name: user.name ?? user.email,
        support_url: "mailto:support@testifi.ai",
      });
      await sendEmail(user.email, confTemplate.subject, "", html);
    }

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------------------------------------------------- */
/*                        REFRESH ACCESS TOKEN                             */
/* ----------------------------------------------------------------------- */
export const refreshAccessToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(401).json({ error: "Refresh token required" });
      return;
    }

    const tokenToVerify = refreshToken.trim();

    let decoded: {
      userId: string;
      email: string;
      credits: number;
      exp: number;
      iat: number;
    };
    try {
      decoded = jwt.verify(tokenToVerify, JWT_SECRET) as typeof decoded;
    } catch (err: any) {
      res.status(403).json({ error: "Invalid refresh token: " + err.message });
      return;
    }

    const storedToken = await prisma.refreshToken.findFirst({
      where: { token: tokenToVerify },
    });
    if (
      !storedToken ||
      storedToken.revoked ||
      new Date() > storedToken.expiresAt
    ) {
      res
        .status(403)
        .json({ error: "Refresh token is invalid, revoked, or expired" });
      return;
    }

    const newAccessToken = jwt.sign(
      {
        userId: decoded.userId,
        email: decoded.email,
        credits: decoded.credits,
      },
      JWT_SECRET,
      { expiresIn: "115m" }
    );

    res.json({ accessToken: newAccessToken });
  } catch (error) {
    next(error);
  }
};

/* ----------------------------------------------------------------------- */
/*                               LOGIN USER                                */
/* ----------------------------------------------------------------------- */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(400).json({ error: "Invalid email or password" });
      return;
    }

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        credits: user.credits,
        role: user.role || "user",
      },
      JWT_SECRET,
      { expiresIn: "115m" }
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        credits: user.credits,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const existingToken = await prisma.refreshToken.findFirst({
      where: { userId: user.id },
    });
    if (existingToken) {
      await prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: {
          token: refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          revoked: false,
        },
      });
    } else {
      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }

    res.json({
      accessToken,
      refreshToken,
      name: user.name || user.email,
      email: user.email,
      credits: user.credits,
      role: user.role || "user",
    });
  } catch (error) {
    next(error);
  }
};

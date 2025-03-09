import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET as string;

// Set up SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);
const senderEmail: string = process.env.EMAIL_USER || "admin@thenexgen.ai";

// Register User
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    res
      .status(201)
      .json({ message: "User registered successfully", userId: user.id });
  } catch (error) {
    next(error);
  }
};

// Login User
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

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "1h",
    });

    res.json({
      token,
      userName: user.name || user.email,
    });
  } catch (error) {
    next(error);
  }
};

// Forgot Password using SendGrid
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
    const resetTokenExp = new Date(Date.now() + 3600000); // 1 hour expiry

    await prisma.user.update({
      where: { email },
      data: { resetToken, resetTokenExp },
    });

    const baseUrl = process.env.BASE_URL || "http://localhost:3000";
    const resetLink = `${baseUrl}/reset-password/${resetToken}`;
    const msg = {
      to: email,
      from: senderEmail,
      subject: "Password Reset",
      text: `Click the link to reset your password: ${resetLink}`,
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password</p>`,
    };

    await sgMail.send(msg);

    res.json({ message: "Password reset link sent to email" });
  } catch (error) {
    next(error);
  }
};

// New Endpoint: Get Reset Email (using a path parameter)
export const getResetEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Unwrap token if it comes as an array
    let token = req.query.token;
    if (Array.isArray(token)) {
      token = token[0];
    }
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
// Reset Password
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

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    next(error);
  }
};

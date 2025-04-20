import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

/* ───────────────────────── constants ───────────────────────── */
export const JWT_SECRET = process.env.JWT_SECRET as string;

/* ───────────────────────── types ───────────────────────────── */
export interface AuthPayload {
  userId: string;
  email: string;
  role: "admin" | "user";
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
}

/* ───────────────── strict auth (blocks) ───────────────────── */
export function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const token = req.headers.authorization?.split(" ")[1]; // Bearer <token>

  if (!token) {
    res.status(401).json({ error: "Access denied, no token provided" });
    return;
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
}

/* ───────────── optional auth (never blocks) ───────────── */
export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.split(" ")[1]
    : undefined;

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthPayload;
    } catch {
      /* bad/expired token → act as guest */
    }
  }
  next();
}

/* ───────────────── admin guard ─────────────────────────── */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

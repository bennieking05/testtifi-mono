import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET as string;

// ✅ Extend Express Request to include `user`
interface AuthRequest extends Request {
  user?: { userId: string; email: string };
}

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1]; // Extract token from "Bearer <token>"

  if (!token) {
    res.status(401).json({ error: "Access denied, no token provided" });
    return; // ✅ Ensure function exits after sending response
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    req.user = decoded; // ✅ Attach decoded user to request
    next(); // ✅ Move to the next middleware/route
  } catch (error) {
    res.status(403).json({ error: "Invalid token" });
    return; // ✅ Ensure function exits after sending response
  }
};

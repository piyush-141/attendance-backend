import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface TeacherPayload {
  id: string;
  email: string;
  name: string;
}

// Extend Express Request to carry the decoded teacher payload
declare global {
  namespace Express {
    interface Request {
      teacher?: TeacherPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = req.cookies?.token as string | undefined;

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }

    const payload = jwt.verify(token, secret) as TeacherPayload;
    req.teacher = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

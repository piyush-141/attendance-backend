import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const teacher = await prisma.teacher.findUnique({ where: { email } });

    if (!teacher) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const passwordValid = await bcrypt.compare(password, teacher.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const secret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      { id: teacher.id, email: teacher.email, name: teacher.name },
      secret,
      { expiresIn: '7d' }
    );

    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
    });
  } catch (err) {
    console.error('[POST /auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});
// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body as { name?: string; email?: string; password?: string };

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Name, email, and password are required' });
      return;
    }

    const existingTeacher = await prisma.teacher.findUnique({ where: { email } });
    if (existingTeacher) {
      res.status(400).json({ error: 'Email is already in use' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const teacher = await prisma.teacher.create({
      data: { name, email, passwordHash },
    });

    const secret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      { id: teacher.id, email: teacher.email, name: teacher.name },
      secret,
      { expiresIn: '7d' }
    );

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      teacher: { id: teacher.id, name: teacher.name, email: teacher.email },
    });
  } catch (err) {
    console.error('[POST /auth/signup]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — check current session
router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ teacher: req.teacher });
});

// PATCH /api/auth/me — update current teacher profile
router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Name is required' });
      return;
    }

    const updatedTeacher = await prisma.teacher.update({
      where: { id: req.teacher!.id },
      data: { name },
    });

    res.json({
      teacher: {
        id: updatedTeacher.id,
        name: updatedTeacher.name,
        email: updatedTeacher.email,
      },
    });
  } catch (err) {
    console.error('[PATCH /auth/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

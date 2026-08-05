import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/subjects — all subjects for the logged-in teacher
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const subjects = await prisma.subject.findMany({
      where: { teacherId: req.teacher!.id },
      include: {
        classes: {
          select: { id: true, name: true },
        },
      },
      orderBy: { code: 'asc' },
    });

    res.json({ subjects });
  } catch (err) {
    console.error('[GET /subjects]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/subjects/:id/classes
router.get('/:id/classes', requireAuth, async (req: Request, res: Response) => {
  try {
    const subject = await prisma.subject.findFirst({
      where: { id: req.params.id, teacherId: req.teacher!.id },
      include: {
        classes: {
          include: {
            _count: { select: { roster: true } },
          },
        },
      },
    });

    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    res.json({ subject });
  } catch (err) {
    console.error('[GET /subjects/:id/classes]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/subjects — create a new subject
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) {
      res.status(400).json({ error: 'Code and name are required' });
      return;
    }

    const subject = await prisma.subject.create({
      data: {
        code,
        name,
        teacherId: req.teacher!.id,
      },
      include: {
        classes: true,
      },
    });

    res.json({ subject });
  } catch (err) {
    console.error('[POST /subjects]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/subjects/:id — delete a subject and all its classes/sessions
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const subject = await prisma.subject.findFirst({
      where: { id: req.params.id, teacherId: req.teacher!.id },
    });
    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }
    // Cascade: sessions -> records; classes -> roster; then subject
    await prisma.$transaction(async (tx) => {
      const classes = await tx.classGroup.findMany({ where: { subjectId: subject.id } });
      for (const cls of classes) {
        const sessions = await tx.attendanceSession.findMany({ where: { classId: cls.id } });
        for (const sess of sessions) {
          await tx.attendanceRecord.deleteMany({ where: { sessionId: sess.id } });
        }
        await tx.attendanceSession.deleteMany({ where: { classId: cls.id } });
        await tx.studentRoster.deleteMany({ where: { classId: cls.id } });
        await tx.classGroup.delete({ where: { id: cls.id } });
      }
      await tx.subject.delete({ where: { id: subject.id } });
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /subjects/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

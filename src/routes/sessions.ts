import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
import { initSession, destroySession, getCurrentQrToken, getTokenTtlMs } from '../lib/qr';
import { getIO } from '../socket';
import QRCode from 'qrcode';

const router = Router();

// POST /api/sessions/start
router.post('/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const { subjectId, classId } = req.body as { subjectId?: string; classId?: string };

    if (!subjectId || !classId) {
      res.status(400).json({ error: 'subjectId and classId are required' });
      return;
    }

    // Verify the class belongs to the teacher
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: classId,
        subject: { id: subjectId, teacherId: req.teacher!.id },
      },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found or unauthorized' });
      return;
    }

    // Check if there's already an active session for this class
    const existingSession = await prisma.attendanceSession.findFirst({
      where: { classId, status: 'ACTIVE' },
    });

    if (existingSession) {
      res.status(409).json({ error: 'An active session already exists for this class', sessionId: existingSession.id });
      return;
    }

    // Session expires in 2 hours (teacher can end it early)
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

    const session = await prisma.attendanceSession.create({
      data: {
        classId,
        teacherId: req.teacher!.id,
        status: 'ACTIVE',
        expiresAt,
      },
    });

    // Start QR rotation in memory
    const firstQrToken = initSession(session.id);

    // Build the QR URL (student will scan this)
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const qrUrl = `${frontendUrl}/scan/${firstQrToken}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 300 });

    res.json({
      session: {
        id: session.id,
        classId: session.classId,
        status: session.status,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
      },
      qr: {
        dataUrl: qrDataUrl,
        token: firstQrToken,
        ttlMs: getTokenTtlMs(session.id),
      },
    });
  } catch (err) {
    console.error('[POST /sessions/start]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/sessions/:id/qr — get current QR code (polled by dashboard)
router.get('/:id/qr', requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: req.params.id, teacherId: req.teacher!.id },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    const qrToken = getCurrentQrToken(session.id);
    if (!qrToken) {
      res.status(500).json({ error: 'QR state not found — session may have been lost on server restart' });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const qrUrl = `${frontendUrl}/scan/${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', width: 300 });

    res.json({
      qr: {
        dataUrl: qrDataUrl,
        token: qrToken,
        ttlMs: getTokenTtlMs(session.id),
      },
    });
  } catch (err) {
    console.error('[GET /sessions/:id/qr]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/sessions/:id/end
router.post('/:id/end', requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await prisma.attendanceSession.findFirst({
      where: { id: req.params.id, teacherId: req.teacher!.id },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Session is not active' });
      return;
    }

    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });

    // Remove QR state from memory
    destroySession(session.id);

    // Notify teacher's browser
    getIO().to(`session:${session.id}`).emit('session:ended');

    res.json({ message: 'Session ended' });
  } catch (err) {
    console.error('[POST /sessions/:id/end]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/records/:sessionId — full attendance sheet for a session
router.get('/records/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await prisma.attendanceSession.findFirst({
      where: {
        id: req.params.sessionId,
        teacherId: req.teacher!.id,
      },
      include: {
        class: {
          include: {
            roster: { orderBy: { rollNo: 'asc' } },
          },
        },
        records: { orderBy: { submittedAt: 'asc' } },
      },
    });

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Compute absentees
    const presentRollNos = new Set(session.records.map((r) => r.rollNo));
    const absentees = session.class.roster.filter((s) => !presentRollNos.has(s.rollNo));

    res.json({
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        class: session.class.name,
      },
      records: session.records,
      absentees,
      totalStudents: session.class.roster.length,
      presentCount: session.records.length,
    });
  } catch (err) {
    console.error('[GET /records/:sessionId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

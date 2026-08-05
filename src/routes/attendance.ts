import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getIO } from '../socket';

const router = Router();

// POST /api/attendance/submit
// The 6-step validation sequence from ARCH.md §6
router.post('/submit', async (req: Request, res: Response) => {
  try {
    let {
      challengeToken,
      rollNo,
      name,
      deviceFingerprint,
    } = req.body as {
      challengeToken?: string;
      rollNo?: string;
      name?: string;
      deviceFingerprint?: string;
    };

    if (!challengeToken || !rollNo || !name || !deviceFingerprint) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    rollNo = rollNo.trim().toUpperCase();

    const cookieId = req.cookies?.['scan_session'] as string | undefined;
    if (!cookieId) {
      res.status(401).json({ error: 'Missing session cookie. Please scan the QR code again.' });
      return;
    }

    // ── Step 1 & 2: Token exists and belongs to an active session ─────────────
    const token = await prisma.attendanceToken.findUnique({
      where: { token: challengeToken },
      include: { session: true },
    });

    if (!token) {
      res.status(400).json({ error: 'Invalid challenge token. Please scan the QR code again.' });
      return;
    }

    if (token.session.status !== 'ACTIVE') {
      res.status(410).json({ error: 'Attendance session has ended.' });
      return;
    }

    // ── Step 2: Token not expired ─────────────────────────────────────────────
    if (new Date() > token.expiresAt) {
      res.status(410).json({ error: 'Challenge token has expired. Please scan the QR code again.' });
      return;
    }

    // ── Step 3: Token not already used ────────────────────────────────────────
    if (token.usedAt !== null) {
      res.status(409).json({ error: 'This QR scan has already been used. Please scan again.' });
      return;
    }

    // ── Step 4: Cookie matches what was issued at scan time ───────────────────
    if (token.cookieId !== cookieId) {
      res.status(401).json({ error: 'Browser mismatch. Please scan the QR code from the same browser.' });
      return;
    }

    const sessionId = token.sessionId;

    // ── Step 5: No existing record for this device fingerprint ────────────────
    const existingByDevice = await prisma.attendanceRecord.findFirst({
      where: { sessionId, deviceFingerprint },
    });

    if (existingByDevice) {
      res.status(409).json({ error: 'Attendance already recorded from this device for this session.' });
      return;
    }

    // ── Step 6: Roll number exists in roster and not already marked ───────────
    const session = await prisma.attendanceSession.findUnique({
      where: { id: sessionId },
    });



    const existingByRoll = await prisma.attendanceRecord.findFirst({
      where: { sessionId, rollNo },
    });

    if (existingByRoll) {
      res.status(409).json({ error: `Roll number ${rollNo} has already been marked present.` });
      return;
    }

    // ── All 6 checks passed — write record + burn token ───────────────────────
    const [record] = await prisma.$transaction([
      prisma.attendanceRecord.create({
        data: {
          sessionId,
          rollNo,
          name,
          deviceFingerprint,
          ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown',
          userAgent: req.headers['user-agent'] || 'unknown',
        },
      }),
      prisma.attendanceToken.update({
        where: { id: token.id },
        data: { usedAt: new Date(), deviceFingerprint },
      }),
    ]);

    // ── Emit real-time event to teacher's dashboard ───────────────────────────
    getIO().to(`session:${sessionId}`).emit('attendance:new', {
      rollNo: record.rollNo,
      name: record.name,
      submittedAt: record.submittedAt,
    });

    res.json({ message: 'Attendance recorded successfully!', rollNo, name });
  } catch (err: unknown) {
    // Handle unique constraint violations gracefully
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      res.status(409).json({ error: 'Attendance already recorded for this device or roll number.' });
      return;
    }
    console.error('[POST /attendance/submit]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

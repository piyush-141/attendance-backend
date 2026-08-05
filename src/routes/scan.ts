import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { validateQrToken } from '../lib/qr';

const router = Router();

// GET /api/scan/:qrToken
// Called when a student scans the QR code.
// Validates session → mints a one-time challenge token → sets HttpOnly cookie
router.get('/:qrToken', async (req: Request, res: Response) => {
  try {
    const { qrToken } = req.params;

    // 1. Validate QR token (in-memory check)
    const sessionId = validateQrToken(qrToken);
    if (!sessionId) {
      res.status(410).json({
        error: 'QR code has expired or is invalid. Please scan the latest code.',
      });
      return;
    }

    // 2. Verify the session is still active in the DB
    const session = await prisma.attendanceSession.findFirst({
      where: { id: sessionId, status: 'ACTIVE' },
      include: { class: { include: { subject: true } } },
    });

    if (!session) {
      res.status(410).json({ error: 'Attendance session has ended.' });
      return;
    }

    // 3. Issue a cookie ID for device binding (if not already present)
    let cookieId = req.cookies?.['scan_session'] as string | undefined;
    if (!cookieId) {
      cookieId = uuidv4();
    }

    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('scan_session', cookieId, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      maxAge: 30 * 60 * 1000, // 30 minutes
    });

    // 4. Mint one-time challenge token (expires in 20s)
    const challengeToken = uuidv4();
    const expiresAt = new Date(Date.now() + 20_000);

    await prisma.attendanceToken.create({
      data: {
        sessionId,
        token: challengeToken,
        cookieId,
        expiresAt,
      },
    });

    res.json({
      challengeToken,
      session: {
        id: session.id,
        subject: `${session.class.subject.code} — ${session.class.subject.name}`,
        class: session.class.name,
      },
    });
  } catch (err) {
    console.error('[GET /scan/:qrToken]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

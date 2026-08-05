import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/classes/:id/records — list of past sessions for a class
router.get('/:id/records', requireAuth, async (req: Request, res: Response) => {
  try {
    // Verify the class belongs to the teacher's subject
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: req.params.id,
        subject: { teacherId: req.teacher!.id },
      },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const sessions = await prisma.attendanceSession.findMany({
      where: { classId: req.params.id },
      orderBy: { startedAt: 'desc' },
      include: {
        _count: { select: { records: true } },
      },
    });

    res.json({ sessions });
  } catch (err) {
    console.error('[GET /classes/:id/records]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/classes/:id/roster — get full student roster
router.get('/:id/roster', requireAuth, async (req: Request, res: Response) => {
  try {
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: req.params.id,
        subject: { teacherId: req.teacher!.id },
      },
      include: {
        roster: { orderBy: { rollNo: 'asc' } },
      },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    res.json({ roster: classGroup.roster });
  } catch (err) {
    console.error('[GET /classes/:id/roster]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/classes — create a new class group
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { subjectId, name } = req.body;
    if (!subjectId || !name) {
      res.status(400).json({ error: 'subjectId and name are required' });
      return;
    }

    // Verify subject belongs to teacher
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, teacherId: req.teacher!.id },
    });

    if (!subject) {
      res.status(404).json({ error: 'Subject not found' });
      return;
    }

    const classGroup = await prisma.classGroup.create({
      data: {
        subjectId,
        name,
      },
    });

    res.json({ classGroup });
  } catch (err) {
    console.error('[POST /classes]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/classes/:id/students — add a student
router.post('/:id/students', requireAuth, async (req: Request, res: Response) => {
  try {
    let { rollNo, name } = req.body;
    if (!rollNo || !name) {
      res.status(400).json({ error: 'rollNo and name are required' });
      return;
    }
    
    rollNo = rollNo.trim().toUpperCase();

    // Verify class belongs to teacher
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: req.params.id,
        subject: { teacherId: req.teacher!.id },
      },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const student = await prisma.studentRoster.create({
      data: {
        classId: req.params.id,
        rollNo,
        name,
      },
    });

    res.json({ student });
  } catch (err: any) {
    console.error('[POST /classes/:id/students]', err);
    if (err.code === 'P2002') {
      res.status(400).json({ error: 'Student with this roll number already exists in this class' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/classes/:id/students/batch — bulk add students
router.post('/:id/students/batch', requireAuth, async (req: Request, res: Response) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      res.status(400).json({ error: 'Array of students is required' });
      return;
    }

    // Verify class belongs to teacher
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: req.params.id,
        subject: { teacherId: req.teacher!.id },
      },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const data = students.map((s: { rollNo: string; name: string }) => ({
      classId: req.params.id,
      rollNo: s.rollNo.trim().toUpperCase(),
      name: s.name,
    }));

    // createMany with skipDuplicates ensures it doesn't fail if a student is already there
    const result = await prisma.studentRoster.createMany({
      data,
      skipDuplicates: true,
    });

    res.json({ count: result.count });
  } catch (err) {
    console.error('[POST /classes/:id/students/batch]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/classes/:id/planned-lectures — update planned lecture count
router.patch('/:id/planned-lectures', requireAuth, async (req: Request, res: Response) => {
  try {
    const { plannedLectures } = req.body as { plannedLectures?: number };
    if (typeof plannedLectures !== 'number' || plannedLectures < 1) {
      res.status(400).json({ error: 'plannedLectures must be a positive number' });
      return;
    }

    const classGroup = await prisma.classGroup.findFirst({
      where: { id: req.params.id, subject: { teacherId: req.teacher!.id } },
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const updated = await prisma.classGroup.update({
      where: { id: req.params.id },
      data: { plannedLectures },
    });

    res.json({ plannedLectures: updated.plannedLectures });
  } catch (err) {
    console.error('[PATCH /classes/:id/planned-lectures]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/classes/:id/report — structured data for Excel export
router.get('/:id/report', requireAuth, async (req: Request, res: Response) => {
  try {
    const classGroup = await prisma.classGroup.findFirst({
      where: {
        id: req.params.id,
        subject: { teacherId: req.teacher!.id },
      },
      include: {
        subject: { include: { teacher: true } },
        roster: { orderBy: { rollNo: 'asc' } }
      }
    });

    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const allSessions = await prisma.attendanceSession.findMany({
      where: { classId: req.params.id },
      orderBy: { startedAt: 'asc' },
      include: { records: true }
    });

    // ── Deduplicate: one session per calendar date (keep the most-attended) ─
    const byDate = new Map<string, typeof allSessions[number]>();
    for (const session of allSessions) {
      const dateKey = new Date(session.startedAt).toLocaleDateString('en-GB'); // DD/MM/YYYY
      const existing = byDate.get(dateKey);
      if (!existing || session.records.length > existing.records.length) {
        byDate.set(dateKey, session);
      }
    }
    const sessions = Array.from(byDate.values()).sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
    );

    // ── Build student map ─────────────────────────────────────────────────
    const studentsMap = new Map<string, { rollNo: string; name: string; attendance: Record<string, boolean> }>();

    if (classGroup.roster.length > 0) {
      for (const student of classGroup.roster) {
        studentsMap.set(student.rollNo, { rollNo: student.rollNo, name: student.name, attendance: {} });
      }
    }

    for (const session of sessions) {
      for (const record of session.records) {
        if (!studentsMap.has(record.rollNo)) {
          studentsMap.set(record.rollNo, { rollNo: record.rollNo, name: record.name, attendance: {} });
        }
        studentsMap.get(record.rollNo)!.attendance[session.id] = true;
      }
    }

    const studentsArray = Array.from(studentsMap.values()).sort((a, b) => a.rollNo.localeCompare(b.rollNo));

    res.json({
      subjectName: classGroup.subject.name,
      className: classGroup.name,
      teacherName: classGroup.subject.teacher.name,
      plannedLectures: classGroup.plannedLectures,
      sessions: sessions.map(s => ({
        id: s.id,
        date: new Date(s.startedAt).toLocaleDateString('en-GB'),
      })),
      students: studentsArray,
    });
  } catch (err) {
    console.error('[GET /classes/:id/report]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/classes/:id — delete a class group and all its sessions/records/roster
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const classGroup = await prisma.classGroup.findFirst({
      where: { id: req.params.id, subject: { teacherId: req.teacher!.id } },
    });
    if (!classGroup) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }
    await prisma.$transaction(async (tx) => {
      const sessions = await tx.attendanceSession.findMany({ where: { classId: classGroup.id } });
      for (const sess of sessions) {
        await tx.attendanceRecord.deleteMany({ where: { sessionId: sess.id } });
      }
      await tx.attendanceSession.deleteMany({ where: { classId: classGroup.id } });
      await tx.studentRoster.deleteMany({ where: { classId: classGroup.id } });
      await tx.classGroup.delete({ where: { id: classGroup.id } });
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /classes/:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

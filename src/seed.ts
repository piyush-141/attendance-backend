import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';

async function main() {
  console.log('🌱 Seeding database...\n');

  // ── Teacher ───────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);

  const teacher = await prisma.teacher.upsert({
    where: { email: 'teacher@demo.com' },
    update: {},
    create: {
      name: 'Prof. Sharma',
      email: 'teacher@demo.com',
      passwordHash,
    },
  });

  console.log(`✅ Teacher: ${teacher.email} (password: password123)`);

  // ── Subjects ──────────────────────────────────────────────────────────────
  const subjects = [
    { code: 'DW', name: 'Data Warehousing' },
    { code: 'CN', name: 'Computer Networks' },
    { code: 'DBMS', name: 'Database Management Systems' },
  ];

  for (const subjectData of subjects) {
    const subject = await prisma.subject.upsert({
      where: {
        // No unique constraint on code alone, use code+teacherId pattern via findFirst
        id: (
          await prisma.subject.findFirst({
            where: { code: subjectData.code, teacherId: teacher.id },
          })
        )?.id ?? 'new',
      },
      update: {},
      create: {
        code: subjectData.code,
        name: subjectData.name,
        teacherId: teacher.id,
      },
    });

    console.log(`  📚 Subject: ${subject.code} — ${subject.name}`);

    // ── Class Groups ─────────────────────────────────────────────────────────
    const classNames = ['CSE-A', 'CSE-B'];

    for (const className of classNames) {
      let classGroup = await prisma.classGroup.findFirst({
        where: { subjectId: subject.id, name: className },
      });

      if (!classGroup) {
        classGroup = await prisma.classGroup.create({
          data: {
            subjectId: subject.id,
            name: className,
          },
        });
      }

      console.log(`    📋 Class: ${className}`);

      // ── Students ────────────────────────────────────────────────────────────
      const studentCount = 30;
      const prefix = className === 'CSE-A' ? 'A' : 'B';

      for (let i = 1; i <= studentCount; i++) {
        const rollNo = `${subjectData.code}${prefix}${String(i).padStart(3, '0')}`;
        const name = generateStudentName(i);

        await prisma.studentRoster.upsert({
          where: { classId_rollNo: { classId: classGroup.id, rollNo } },
          update: {},
          create: { classId: classGroup.id, rollNo, name },
        });
      }

      console.log(`       👥 ${studentCount} students added`);
    }
  }

  console.log('\n✨ Seed complete!');
  console.log('   Login: teacher@demo.com / password123\n');
}

function generateStudentName(index: number): string {
  const firstNames = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun',
    'Sai', 'Reyansh', 'Ayaan', 'Atharv', 'Krishna',
    'Ishaan', 'Shaurya', 'Dhruv', 'Kabir', 'Ritvik',
    'Priya', 'Ananya', 'Diya', 'Kavya', 'Shreya',
    'Anika', 'Meera', 'Nisha', 'Riya', 'Sara',
    'Tanvi', 'Pooja', 'Sneha', 'Divya', 'Neha',
  ];

  const lastNames = [
    'Sharma', 'Verma', 'Singh', 'Kumar', 'Gupta',
    'Patel', 'Mehta', 'Shah', 'Jain', 'Agarwal',
  ];

  const first = firstNames[(index - 1) % firstNames.length];
  const last = lastNames[(index - 1) % lastNames.length];
  return `${first} ${last}`;
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

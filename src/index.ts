import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { setIO } from './socket';
import authRouter from './routes/auth';
import subjectsRouter from './routes/subjects';
import classesRouter from './routes/classes';
import sessionsRouter from './routes/sessions';
import scanRouter from './routes/scan';
import attendanceRouter from './routes/attendance';

const app = express();
const httpServer = http.createServer(app);

// ── CORS ──────────────────────────────────────────────────────────────────────
const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

app.use(
  cors({
    origin: frontendUrl,
    credentials: true, // Required for HttpOnly cookies
  })
);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ── Timing Middleware ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const duration = performance.now() - start;
    console.log(`[API Timing] ${req.method} ${req.originalUrl} - ${duration.toFixed(2)}ms`);
  });
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/subjects', subjectsRouter);
app.use('/api/classes', classesRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/scan', scanRouter);
app.use('/api/attendance', attendanceRouter);

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ── Socket.IO ─────────────────────────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: frontendUrl,
    credentials: true,
  },
});

setIO(io);

io.on('connection', (socket) => {
  console.log(`[Socket.IO] Client connected: ${socket.id}`);

  // Teacher joins a session room to receive live updates
  socket.on('join:session', (sessionId: string) => {
    socket.join(`session:${sessionId}`);
    console.log(`[Socket.IO] Socket ${socket.id} joined session:${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '4000', 10);

httpServer.listen(PORT, () => {
  console.log(`\n🎓 Attendance backend running on http://localhost:${PORT}`);
  console.log(`   Frontend allowed from: ${frontendUrl}`);
  console.log(`   Environment: ${process.env.NODE_ENV ?? 'development'}\n`);
});

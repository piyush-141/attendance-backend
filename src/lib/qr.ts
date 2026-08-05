import { v4 as uuidv4 } from 'uuid';

// In-memory QR rotation state per active session
// sessionId → { currentQrToken, issuedAt }
interface QrState {
  currentQrToken: string;
  issuedAt: Date;
}

const qrStore = new Map<string, QrState>();

// How long (ms) each QR token stays valid
const QR_ROTATION_INTERVAL_MS = 9000; // 9 seconds

/**
 * Initialize QR rotation for a session.
 * Called when "Start Attendance" is clicked.
 */
export function initSession(sessionId: string): string {
  const token = uuidv4();
  qrStore.set(sessionId, { currentQrToken: token, issuedAt: new Date() });
  return token;
}

/**
 * Get the current valid QR token for a session.
 * Rotates automatically if the current token has expired.
 */
export function getCurrentQrToken(sessionId: string): string | null {
  const state = qrStore.get(sessionId);
  if (!state) return null;

  const age = Date.now() - state.issuedAt.getTime();
  if (age > QR_ROTATION_INTERVAL_MS) {
    // Rotate
    const newToken = uuidv4();
    qrStore.set(sessionId, { currentQrToken: newToken, issuedAt: new Date() });
    return newToken;
  }

  return state.currentQrToken;
}

/**
 * Validate whether a given QR token is the current valid one for its session.
 * Returns the sessionId if valid, null otherwise.
 */
export function validateQrToken(qrToken: string): string | null {
  for (const [sessionId, state] of qrStore.entries()) {
    if (state.currentQrToken === qrToken) {
      const age = Date.now() - state.issuedAt.getTime();
      // Give a small grace window (extra 2s) in case of clock drift / network delay
      if (age <= QR_ROTATION_INTERVAL_MS + 2000) {
        return sessionId;
      }
    }
  }
  return null;
}

/**
 * Remove session QR state when attendance ends.
 */
export function destroySession(sessionId: string): void {
  qrStore.delete(sessionId);
}

/**
 * Milliseconds until the current QR token expires (for frontend polling hint).
 */
export function getTokenTtlMs(sessionId: string): number {
  const state = qrStore.get(sessionId);
  if (!state) return 0;
  const age = Date.now() - state.issuedAt.getTime();
  return Math.max(0, QR_ROTATION_INTERVAL_MS - age);
}

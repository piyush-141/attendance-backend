import { Server as SocketIOServer } from 'socket.io';

// Singleton Socket.IO server instance, set during app startup
let _io: SocketIOServer | null = null;

export function setIO(io: SocketIOServer): void {
  _io = io;
}

export function getIO(): SocketIOServer {
  if (!_io) {
    throw new Error('Socket.IO server not initialized. Call setIO() first.');
  }
  return _io;
}

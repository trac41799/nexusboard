import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { getAccessToken } from '../api/client';

const SOCKET_URL: string = import.meta.env.DEV ? 'http://localhost:3000' : '';

export function useSocket(workspaceId: string | undefined | null): Socket | null {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;

    const instance: Socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    instance.on('connect', () => {
      socketRef.current = instance;
      setSocket(instance);
    });

    instance.on('disconnect', () => {
      setSocket(null);
    });

    return () => {
      instance.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, []);

  useEffect(() => {
    const current = socketRef.current;
    if (!current || !workspaceId) return;

    current.emit('join:workspace', workspaceId);

    return () => {
      current.emit('leave:workspace', workspaceId);
    };
  }, [workspaceId]);

  return socket;
}

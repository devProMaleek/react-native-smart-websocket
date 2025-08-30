import {
  useContext,
} from 'react';
import { WebSocketConnection } from '../types';
import { WebSocketManagerContext } from '../context/web-socket-provider';

// Hook to get a specific WebSocket connection
export const useWebSocket = (connectionId: string): WebSocketConnection => {
  const context = useContext(WebSocketManagerContext);
  if (!context) {
    throw new Error(
      'useWebSocket must be used within a WebSocketManagerProvider',
    );
  }

  const connection = context.getConnection(connectionId);
  if (!connection) {
    throw new Error(
      `WebSocket connection '${connectionId}' not found. Available connections: ${Array.from(context.connections.keys()).join(', ')}`,
    );
  }

  return connection;
};
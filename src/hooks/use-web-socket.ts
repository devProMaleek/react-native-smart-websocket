import { WebSocketConnection } from '../types';
import { useConnectionContext } from '../context/web-socket-provider';

/**
 * Get a specific WebSocket connection by id. Reads the connection's dedicated
 * context, so it only re-renders when that connection updates.
 *
 * The message type defaults to `unknown` (narrow before use). Pass a type
 * argument to opt into typed messaging:
 *
 * ```ts
 * const { lastJsonMessage, sendJsonMessage } = useWebSocket<TimelineEvent>('timeline');
 * ```
 */
export const useWebSocket = <TJsonMessage = unknown, TMessageData = string>(
  connectionId: string
): WebSocketConnection<TJsonMessage, TMessageData> => {
  const connection = useConnectionContext(connectionId);

  if (!connection) {
    throw new Error(
      `WebSocket connection '${connectionId}' not found. ` +
        'Make sure the connection id matches a config passed to ' +
        'WebSocketManagerProvider and that the hook is called within the ' +
        'provider tree.'
    );
  }

  // The registry holds heterogeneous connections typed as `unknown` messages;
  // cast to the caller-requested type at this type-erasure boundary.
  return connection as unknown as WebSocketConnection<
    TJsonMessage,
    TMessageData
  >;
};

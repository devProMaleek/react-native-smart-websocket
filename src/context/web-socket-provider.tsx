import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { ConnectionManager } from '../core/connection-manager';
import type {
  WebSocketConnection,
  WebSocketManagerContextType,
  WebSocketManagerProviderProps,
} from '../types';

const ManagerContext = createContext<ConnectionManager | null>(null);

const subscribeToNothing = () => () => {};
const NO_CONNECTIONS = new Map<string, WebSocketConnection>();
const getNoConnections = () => NO_CONNECTIONS;

export const WebSocketManagerProvider: React.FC<
  WebSocketManagerProviderProps
> = ({ children, connections }) => {
  const [manager] = useState(() => new ConnectionManager(AppState));

  // Create connections for new ids while rendering so useWebSocket(id) can
  // read them on the first render; sockets only open in the effect below.
  manager.ensure(connections);

  useEffect(() => {
    manager.sync(connections);
  }, [manager, connections]);

  useEffect(() => () => manager.stopAll(), [manager]);

  // Duplicate ids would share one connection, so only one config applies.
  if (process.env.NODE_ENV !== 'production') {
    const ids = connections.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      console.warn(
        '[react-native-smart-websocket] Duplicate connection ids detected. ' +
          'Each WebSocketConfig.id must be unique.'
      );
    }
  }

  return (
    <ManagerContext.Provider value={manager}>
      {children}
    </ManagerContext.Provider>
  );
};

// Hook to get all connections (for debugging/monitoring). Reactive: re-renders
// when connections are added, removed, or update.
export const useWebSocketManager = (): WebSocketManagerContextType => {
  const manager = useContext(ManagerContext);
  const connections = useSyncExternalStore(
    manager ? manager.subscribe : subscribeToNothing,
    manager ? manager.getConnectionsSnapshot : getNoConnections
  );

  if (!manager) {
    throw new Error(
      'useWebSocketManager must be used within a WebSocketManagerProvider'
    );
  }

  return {
    connections,
    getConnection: (id: string) => connections.get(id),
  };
};

// Internal: subscribes to a single connection, so a component only re-renders
// when that connection changes. Returns null if the id isn't configured.
export const useManagedConnection = (
  connectionId: string
): WebSocketConnection | null => {
  const connection = useContext(ManagerContext)?.get(connectionId) ?? null;

  const subscribe = useCallback(
    (listener: () => void) =>
      connection ? connection.subscribe(listener) : () => {},
    [connection]
  );
  const getSnapshot = useCallback(
    () => connection?.getSnapshot() ?? null,
    [connection]
  );

  return useSyncExternalStore(subscribe, getSnapshot);
};

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  WebSocketConfig,
  WebSocketConnection,
  WebSocketManagerContextType,
  WebSocketManagerProviderProps,
} from '../types';
import { useWebSocketWithParams } from '../utils';

// --- Per-connection context registry ---
//
// Each connection id gets its own React context so that updates to one
// connection only re-render the consumers of that specific connection — a
// message on connection "a" never re-renders a component reading connection
// "b". Contexts are created lazily and cached for the lifetime of the module.

const connectionContextMap = new Map<
  string,
  React.Context<WebSocketConnection | null>
>();

const getConnectionContext = (
  id: string
): React.Context<WebSocketConnection | null> => {
  let ctx = connectionContextMap.get(id);
  if (!ctx) {
    ctx = createContext<WebSocketConnection | null>(null);
    ctx.displayName = `WebSocket(${id})`;
    connectionContextMap.set(id, ctx);
  }
  return ctx;
};

// --- Manager store (for useWebSocketManager / monitoring) ---
//
// A small external store keeps a registry of every live connection. Slots write
// to it; `useWebSocketManager` subscribes to it. Because the store lives outside
// React state, updating it never re-renders the slot tree, so per-connection
// render isolation is preserved.

type StoreListener = () => void;

interface ConnectionStore {
  connections: Map<string, WebSocketConnection>;
  set: (id: string, connection: WebSocketConnection) => void;
  remove: (id: string) => void;
  getConnection: (id: string) => WebSocketConnection | undefined;
  subscribe: (listener: StoreListener) => () => void;
}

const createConnectionStore = (): ConnectionStore => {
  const connections = new Map<string, WebSocketConnection>();
  const listeners = new Set<StoreListener>();
  const emit = () => listeners.forEach((listener) => listener());

  return {
    connections,
    set: (id, connection) => {
      connections.set(id, connection);
      emit();
    },
    remove: (id) => {
      if (connections.delete(id)) {
        emit();
      }
    },
    getConnection: (id) => connections.get(id),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const WebSocketStoreContext = createContext<ConnectionStore | null>(null);

// --- Individual connection component (safe hook lifecycle) ---

interface WebSocketSlotProps {
  config: WebSocketConfig;
  store: ConnectionStore;
  children: React.ReactNode;
}

/**
 * Renders one isolated WebSocket connection. Each slot calls the connection
 * hook exactly once, so the number of hooks is stable per component and the
 * `connections` list can change length/order safely (no Rules-of-Hooks
 * violation). It provides its value through a dedicated per-connection context
 * and mirrors it into the manager store for monitoring.
 */
const WebSocketSlot: React.FC<WebSocketSlotProps> = ({
  config,
  store,
  children,
}) => {
  const webSocketData = useWebSocketWithParams(
    config.baseUrl,
    config.initialQueryParams || {},
    config.options || {},
    config.initialEnabled ?? false
  );

  const connection: WebSocketConnection = useMemo(
    () => ({
      ...webSocketData,
      id: config.id,
      url: webSocketData.debugInfo.url, // Use the full URL from debugInfo
    }),
    [webSocketData, config.id]
  );

  const ConnectionContext = getConnectionContext(config.id);

  // Mirror the latest connection into the manager store whenever an observable
  // signal changes. We depend on individual signals rather than the
  // `connection` object (whose identity changes every render) to avoid
  // needlessly notifying store subscribers on every render.
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  useEffect(() => {
    store.set(config.id, connectionRef.current);
  }, [
    store,
    config.id,
    webSocketData.readyState,
    webSocketData.lastMessage,
    webSocketData.lastJsonMessage,
    webSocketData.isEnabled,
    webSocketData.isConnected,
    webSocketData.connectionStatus,
    webSocketData.messageHistory,
    webSocketData.currentParams,
  ]);

  // Remove from the store when this connection unmounts.
  useEffect(() => {
    return () => store.remove(config.id);
  }, [store, config.id]);

  return (
    <ConnectionContext.Provider value={connection}>
      {children}
    </ConnectionContext.Provider>
  );
};

// --- Provider ---

export const WebSocketManagerProvider: React.FC<
  WebSocketManagerProviderProps
> = ({ children, connections: connectionConfigs }) => {
  // Create the manager store once.
  const storeRef = useRef<ConnectionStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createConnectionStore();
  }
  const store = storeRef.current;

  // Warn on duplicate ids — they'd collide in both the context registry and
  // the manager store.
  if (process.env.NODE_ENV !== 'production') {
    const ids = connectionConfigs.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      console.warn(
        '[react-native-smart-websocket] Duplicate connection ids detected. ' +
          'Each WebSocketConfig.id must be unique.'
      );
    }
  }

  // Nest a slot per connection config around the children. Each slot owns a
  // safe hook lifecycle and provides its own per-connection context. The slots
  // are evaluated synchronously during render, so useWebSocket(id) resolves on
  // first read with no readiness gating.
  return (
    <WebSocketStoreContext.Provider value={store}>
      {connectionConfigs.reduceRight<React.ReactNode>(
        (nested, config) => (
          <WebSocketSlot key={config.id} config={config} store={store}>
            {nested}
          </WebSocketSlot>
        ),
        children
      )}
    </WebSocketStoreContext.Provider>
  );
};

// --- Consumer hooks ---

// Hook to get all connections (for debugging/monitoring). Reactive: re-renders
// when connections are added, removed, or update.
export const useWebSocketManager = (): WebSocketManagerContextType => {
  const store = useContext(WebSocketStoreContext);
  if (!store) {
    throw new Error(
      'useWebSocketManager must be used within a WebSocketManagerProvider'
    );
  }

  const [, forceUpdate] = useReducer((count: number) => count + 1, 0);
  useEffect(() => store.subscribe(forceUpdate), [store]);

  return {
    connections: store.connections,
    getConnection: store.getConnection,
  };
};

// Internal helper used by the useWebSocket hook to read a connection's context.
export const useConnectionContext = (
  connectionId: string
): WebSocketConnection | null => {
  const ConnectionContext = getConnectionContext(connectionId);
  return useContext(ConnectionContext);
};

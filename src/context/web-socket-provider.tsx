import React, {
  createContext,
  useContext,
  useMemo,
} from 'react';
import { WebSocketConnection, WebSocketManagerContextType, WebSocketManagerProviderProps } from '../types';
import { useWebSocketWithParams } from '../utils';


export const WebSocketManagerContext =
  createContext<WebSocketManagerContextType | null>(null);

export const WebSocketManagerProvider: React.FC<
  WebSocketManagerProviderProps
> = ({ children, connections: connectionConfigs }) => {
  // Create individual WebSocket connections with param management and connection control
  const webSocketConnections = connectionConfigs.map((config) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const webSocketData = useWebSocketWithParams(
      config.baseUrl,
      config.initialQueryParams || {},
      config.options || {},
      config.initialEnabled ?? false, // Default to disabled
    );

    return {
      ...webSocketData,
      id: config.id,
      url: webSocketData.debugInfo.url, // Use the full URL from debugInfo
    };
  });

  const connections = useMemo(() => {
    const connectionMap = new Map<string, WebSocketConnection>();
    webSocketConnections.forEach((connection) => {
      connectionMap.set(connection.id, connection);
    });
    return connectionMap;
  }, [webSocketConnections]);

  const getConnection = (id: string) => connections.get(id);

  return (
    <WebSocketManagerContext.Provider value={{ connections, getConnection }}>
      {children}
    </WebSocketManagerContext.Provider>
  );
};

// Hook to get all connections (for debugging/monitoring)
export const useWebSocketManager = () => {
  const context = useContext(WebSocketManagerContext);
  if (!context) {
    throw new Error(
      'useWebSocketManager must be used within a WebSocketManagerProvider',
    );
  }
  return context;
};

import type { AppStateStatus } from 'react-native';
import type { ReactNode } from 'react';
import type { ReadyState } from '../core/ready-state';

export type QueryParams = Record<string, string | number | boolean>;

export type ConnectionStatus =
  | 'Disabled'
  | 'Paused (Background)'
  | 'Uninstantiated'
  | 'Connecting'
  | 'Connected'
  | 'Closing'
  | 'Closed';

export interface UseCustomWebSocketReturn<
  TJsonMessage = unknown,
  TMessageData = string,
> {
  sendMessage: (message: string) => void;
  sendJsonMessage: (object: TJsonMessage) => void;
  lastMessage: MessageEvent<TMessageData> | null;
  lastJsonMessage: TJsonMessage | null;
  messageHistory: MessageEvent<TMessageData>[];
  readyState: ReadyState;
  connectionStatus: ConnectionStatus;
  isConnected: boolean;
  getWebSocket: () => WebSocket | null;
  debugInfo: {
    url: string | null;
    attempts: number;
    lastError: string | null;
    appState: AppStateStatus;
    isPaused: boolean;
    isEnabled: boolean;
  };
  // Connection management
  forceReconnect: () => void;
  disconnect: () => void;
  enable: () => void;
  disable: () => void;
  isEnabled: boolean;
}

export interface CustomWebSocketOptions {
  onOpen?: (event: Event) => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (event: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  /** WebSocket subprotocols to request, passed to `new WebSocket(url, protocols)`. */
  protocols?: string | string[];
  /** Log connection activity to the console. Defaults to `false`. */
  debug?: boolean;
  /** Send keep-alive pings and reconnect when the server stops answering. Defaults to `false`. */
  enableHeartbeat?: boolean;
  /** Close the socket while the app is in the background. Defaults to `true`. */
  pauseOnBackground?: boolean;
  /** Reopen a socket paused in the background once the app is active again. Defaults to `true`. */
  reconnectOnForeground?: boolean;
  /** Enable automatic reconnection on unexpected close. Defaults to `true`. */
  enableReconnect?: boolean;
  /** Retry the connection when an error occurs. Defaults to `true`. */
  retryOnError?: boolean;
}

// Generic WebSocket manager that handles multiple connections
export interface WebSocketConnection<
  TJsonMessage = unknown,
  TMessageData = string,
> extends UseCustomWebSocketReturn<TJsonMessage, TMessageData> {
  id: string;
  url: string | null;
  updateQueryParams: (params: QueryParams) => void;
  clearQueryParams: () => void;
  currentParams: QueryParams;
}

export interface WebSocketManagerContextType {
  connections: Map<string, WebSocketConnection>;
  getConnection: (id: string) => WebSocketConnection | undefined;
}

export interface WebSocketConfig {
  id: string;
  baseUrl: string | null;
  initialQueryParams?: QueryParams;
  initialEnabled?: boolean; // Control whether to connect immediately
  options?: CustomWebSocketOptions;
}

export interface WebSocketManagerProviderProps {
  children: ReactNode;
  connections: WebSocketConfig[];
}

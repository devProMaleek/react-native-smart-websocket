import { type AppStateStatus } from 'react-native';
import {
  type ReactNode,
} from 'react';
import { type Options, ReadyState } from 'react-use-websocket';
import { useCustomWebSocket } from '../hooks/use-custom-web-socket';

export interface UseCustomWebSocketReturn<
  TJsonMessage = any,
  TMessageData = string
> {
  sendMessage: (message: string) => void;
  sendJsonMessage: (object: TJsonMessage) => void;
  lastMessage: MessageEvent<TMessageData> | null;
  lastJsonMessage: TJsonMessage | null;
  messageHistory: MessageEvent<TMessageData>[];
  readyState: ReadyState;
  connectionStatus: string;
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

export interface CustomWebSocketOptions extends Partial<Options> {
  onOpen?: () => void;
  onClose?: (event?: CloseEvent) => void;
  onError?: (error: Event) => void;
  onMessage?: (message: MessageEvent) => void;
  debug?: boolean;
  enableHeartbeat?: boolean;
  pauseOnBackground?: boolean;
  reconnectOnForeground?: boolean;
}

// Generic WebSocket manager that handles multiple connections
export interface WebSocketConnection extends UseCustomWebSocketReturn {
  id: string;
  url: string | null;
  updateQueryParams: (
    params: Record<string, string | number | boolean>,
  ) => void;
  clearQueryParams: () => void;
  currentParams: Record<string, string | number | boolean>;
}

export interface WebSocketManagerContextType {
  connections: Map<string, WebSocketConnection>;
  getConnection: (id: string) => WebSocketConnection | undefined;
}

export interface WebSocketConfig {
  id: string;
  baseUrl: string | null;
  initialQueryParams?: Record<string, string | number | boolean>;
  initialEnabled?: boolean; // Control whether to connect immediately
  options?: Parameters<typeof useCustomWebSocket>[1];
}

export interface WebSocketManagerProviderProps {
  children: ReactNode;
  connections: WebSocketConfig[];
}
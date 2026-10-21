import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { CustomWebSocketOptions, UseCustomWebSocketReturn } from '../types';

// Human-readable descriptions for WebSocket close codes (used in debug logs).
const CLOSE_CODE_INFO: Record<number, string> = {
  1000: '✅ Normal closure (intentional)',
  1001: '🔄 Going away (page unload/refresh)',
  1002: '❌ Protocol error',
  1003: '❌ Unsupported data type',
  1006: '⚠️ Abnormal closure (connection lost)',
  1007: '❌ Invalid frame payload data',
  1008: '❌ Policy violation',
  1009: '❌ Message too big',
  1010: '❌ Mandatory extension missing',
  1011: '💥 Server error',
  1012: '🔧 Service restart',
  1013: '⏳ Try again later',
  1014: '🌐 Bad gateway',
  1015: '🔒 TLS handshake failure',
};

interface CloseDebugContext {
  url: string | null;
  event: CloseEvent;
  connectionDuration: number;
  appState: AppStateStatus;
  isPaused: boolean;
  isEnabled: boolean;
  isManuallyDisconnected: boolean;
}

// Extracted from onClose to keep that callback's cyclomatic complexity low.
const logCloseDebugInfo = ({
  url,
  event,
  connectionDuration,
  appState,
  isPaused,
  isEnabled,
  isManuallyDisconnected,
}: CloseDebugContext): void => {
  console.log('❌ WebSocket connection closed', {
    url,
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
    connectionDuration: `${connectionDuration}ms`,
    appState,
    isPaused,
    isEnabled,
    timestamp: new Date().toISOString(),
  });

  const reason = CLOSE_CODE_INFO[event.code] || `❓ Unknown (${event.code})`;
  console.log(`📋 Close reason: ${reason}`);

  // Warn about very short connections (might indicate a problem). Only when the
  // drop wasn't something we triggered ourselves (manual disconnect / pause).
  const wasUnexpectedDrop = !isManuallyDisconnected && !isPaused;
  if (connectionDuration < 5000 && wasUnexpectedDrop) {
    console.warn(
      '⚠️ Very short connection duration - possible connection issue'
    );
  }
};

export const useCustomWebSocket = <
  TJsonMessage = unknown,
  TMessageData = string,
>(
  url: string | null,
  options: CustomWebSocketOptions = {},
  initialEnabled: boolean = true
): UseCustomWebSocketReturn<TJsonMessage, TMessageData> => {
  const reconnectAttempts = useRef(0);
  const lastError = useRef<string | null>(null);
  const connectionStartTime = useRef<number | null>(null);
  // Resets the reconnect counter only after a connection has stayed open long
  // enough to be considered stable (see onOpen). Prevents flapping connections
  // from resetting the counter and reconnecting forever.
  const stabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set when the socket reports an error. The close event that always follows
  // reads it so shouldReconnect can apply the `retryOnError` option.
  const closedAfterError = useRef(false);

  // Message history (reactive so consumers re-render as messages arrive)
  const [messageHistory, setMessageHistory] = useState<
    MessageEvent<TMessageData>[]
  >([]);

  // Connection enabled state
  const [isEnabled, setIsEnabled] = useState(initialEnabled);

  // AppState management refs
  const currentAppState = useRef<AppStateStatus>(AppState.currentState);
  const wasConnectedBeforeBackground = useRef(false);

  // Manual-disconnect flag kept as both a ref (read inside the stable WebSocket
  // config callbacks) and state (so render-time memos recompute reactively).
  const isManuallyDisconnectedRef = useRef(false);
  const [isManuallyDisconnected, setIsManuallyDisconnectedState] =
    useState(false);
  const setIsManuallyDisconnected = useCallback((value: boolean) => {
    isManuallyDisconnectedRef.current = value;
    setIsManuallyDisconnectedState(value);
  }, []);

  // Paused-due-to-app-state: same ref + state pairing.
  const isPausedRef = useRef(false);
  const [isPaused, setIsPausedState] = useState(false);
  const setPaused = useCallback((value: boolean) => {
    isPausedRef.current = value;
    setIsPausedState(value);
  }, []);

  // forceReconnect() withholds the URL for one render so react-use-websocket
  // tears the socket down, then restores it to open a fresh connection.
  const [isRestarting, setIsRestarting] = useState(false);

  const debug = useMemo(() => options.debug ?? false, [options.debug]); // Disable debug by default
  const enableHeartbeat = useMemo(
    () => options.enableHeartbeat ?? false,
    [options.enableHeartbeat]
  );
  const pauseOnBackground = useMemo(
    () => options.pauseOnBackground ?? true,
    [options.pauseOnBackground]
  );
  const reconnectOnForeground = useMemo(
    () => options.reconnectOnForeground ?? true,
    [options.reconnectOnForeground]
  );
  const enableReconnect = useMemo(
    () => options.enableReconnect ?? true,
    [options.enableReconnect]
  );
  const retryOnError = useMemo(
    () => options.retryOnError ?? true,
    [options.retryOnError]
  );
  const share = useMemo(() => options.share ?? false, [options.share]);

  // Store callbacks in refs to prevent recreating WebSocket config
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Centralized debug logger. When debug is off every method is a no-op, so
  // call sites can log unconditionally instead of wrapping each one in
  // `if (debug)`. Use `log.enabled` to guard work that's only worth doing for
  // logging (e.g. building large debug payloads).
  const log = useMemo(() => {
    const noop = () => undefined;
    if (!debug) {
      return { enabled: false, info: noop, warn: noop, error: noop };
    }
    return {
      enabled: true,
      info: (...args: unknown[]) => console.log(...args),
      warn: (...args: unknown[]) => console.warn(...args),
      error: (...args: unknown[]) => console.error(...args),
    };
  }, [debug]);

  // Helper function to detect heartbeat messages
  const isHeartbeatMessage = useCallback(
    (data: unknown): boolean => {
      if (!enableHeartbeat) return false;
      if (data === '{"type":"pong"}' || data === 'pong') return true;
      if (typeof data === 'string' && data.includes('"type":"pong"'))
        return true;
      return false;
    },
    [enableHeartbeat]
  );

  // Determine if WebSocket should be active based on app state and enabled state
  const shouldBeConnected = useMemo(() => {
    if (!url) return false;
    if (!isEnabled) return false; // Don't connect if disabled
    if (isManuallyDisconnected) return false;
    if (isRestarting) return false;
    if (pauseOnBackground && isPaused) return false;
    return true;
  }, [
    url,
    isEnabled,
    isManuallyDisconnected,
    isRestarting,
    pauseOnBackground,
    isPaused,
  ]);

  // Create stable WebSocket configuration
  const webSocketConfig = useMemo(
    () => ({
      share,
      // All reconnects are decided in shouldReconnect, so the attempt limit and
      // enableReconnect apply to every close. react-use-websocket's own
      // retryOnError would reconnect from its error handler without asking
      // shouldReconnect; since every WebSocket error is followed by a close
      // event, our retryOnError option is applied there instead.
      retryOnError: false,
      protocols: [],

      onOpen: (_event: Event) => {
        lastError.current = null;
        connectionStartTime.current = Date.now();
        setPaused(false);

        // Only reset the reconnect counter once the connection has been stable
        // for 5 seconds, so a connection that opens then immediately drops
        // keeps accumulating attempts instead of retrying forever.
        if (stabilityTimer.current) {
          clearTimeout(stabilityTimer.current);
        }
        stabilityTimer.current = setTimeout(() => {
          reconnectAttempts.current = 0;
          stabilityTimer.current = null;
        }, 5000);

        if (log.enabled) {
          log.info('✅ WebSocket connected successfully', {
            url,
            appState: currentAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }
        callbacksRef.current.onOpen?.();
      },

      onClose: (event: CloseEvent) => {
        // Connection dropped before it was considered stable — cancel the timer
        // so the reconnect counter keeps accumulating.
        if (stabilityTimer.current) {
          clearTimeout(stabilityTimer.current);
          stabilityTimer.current = null;
        }

        const connectionDuration = connectionStartTime.current
          ? Date.now() - connectionStartTime.current
          : 0;

        if (log.enabled) {
          logCloseDebugInfo({
            url,
            event,
            connectionDuration,
            appState: currentAppState.current,
            isPaused: isPausedRef.current,
            isEnabled,
            isManuallyDisconnected: isManuallyDisconnectedRef.current,
          });
        }

        callbacksRef.current.onClose?.(event);
      },

      onError: (error: Event) => {
        const errorMsg = `WebSocket error: ${error.type}`;
        lastError.current = errorMsg;
        closedAfterError.current = true;

        if (log.enabled) {
          log.error('🚨 WebSocket error:', {
            url,
            errorType: error.type,
            attempts: reconnectAttempts.current,
            appState: currentAppState.current,
            isPaused: isPausedRef.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }
        callbacksRef.current.onError?.(error);
      },

      onMessage: (message: MessageEvent) => {
        setMessageHistory((prev) => {
          const next = [...prev, message as MessageEvent<TMessageData>];
          return next.length > 50 ? next.slice(-50) : next;
        });

        const isHeartbeat = isHeartbeatMessage(message.data);

        if (log.enabled && !isHeartbeat) {
          log.info('📨 Message received:', {
            data: message.data,
            size: `${message.data.length} chars`,
            appState: currentAppState.current,
            timestamp: new Date().toISOString(),
          });
        }

        callbacksRef.current.onMessage?.(message);
      },

      shouldReconnect: (event: CloseEvent | WebSocketEventMap['close']) => {
        const followedError = closedAfterError.current;
        closedAfterError.current = false;

        // Don't reconnect if reconnection is disabled entirely
        if (!enableReconnect) {
          log.info('🚫 Skipping reconnect - reconnect disabled');
          return false;
        }

        // Don't reconnect after a connection error unless retryOnError allows it
        if (followedError && !retryOnError) {
          log.info('🚫 Skipping reconnect - error and retryOnError is off');
          return false;
        }

        // Don't reconnect if disabled
        if (!isEnabled) {
          log.info('🚫 Skipping reconnect - connection disabled');
          return false;
        }

        // Don't reconnect if manually disconnected
        if (isManuallyDisconnectedRef.current) {
          log.info('🚫 Skipping reconnect - manual disconnect');
          return false;
        }

        // Don't reconnect if paused due to app state
        if (isPausedRef.current) {
          log.info('🚫 Skipping reconnect - paused due to app state');
          return false;
        }

        // Don't reconnect on intentional close codes
        const noReconnectCodes = [1000, 1001];
        const code = (event as CloseEvent).code ?? 1006;
        if (noReconnectCodes.includes(code)) {
          log.info(`🚫 Skipping reconnect - close code ${code}`);
          return false;
        }

        // Manual counter is the single source of truth (so the stability timer
        // can reset it). Cap reconnection at 5 attempts.
        reconnectAttempts.current += 1;
        const canReconnect = reconnectAttempts.current <= 5;

        if (log.enabled) {
          log.info('🔄 Reconnection decision:', {
            canReconnect,
            closeCode: code,
            attempts: `${reconnectAttempts.current}/5`,
            appState: currentAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }

        return canReconnect;
      },

      reconnectInterval: (attemptNumber: number) => {
        // Progressive backoff: 1s, 2s, 4s, 8s, 16s
        const baseInterval = 1000;
        const interval = Math.min(
          baseInterval * Math.pow(2, attemptNumber),
          16000
        );

        log.info(
          `⏳ Reconnecting in ${interval}ms (attempt ${attemptNumber + 1}/5)`
        );
        return interval;
      },

      // Optional heartbeat - only if enabled
      ...(enableHeartbeat && {
        heartbeat: {
          message: JSON.stringify({ type: 'ping' }),
          returnMessage: JSON.stringify({ type: 'pong' }),
          timeout: 20000, // 20 seconds timeout
          interval: 10000, // 10 seconds interval
        },
      }),
    }),
    [
      enableHeartbeat,
      enableReconnect,
      retryOnError,
      share,
      log,
      url,
      isHeartbeatMessage,
      isEnabled,
      setPaused,
    ]
  );

  const {
    sendMessage,
    sendJsonMessage,
    lastMessage,
    lastJsonMessage,
    readyState,
    getWebSocket,
  } = useWebSocket<TJsonMessage>(
    shouldBeConnected ? url : null,
    webSocketConfig
  );

  // Second half of forceReconnect(): restore the URL once the old socket has
  // been torn down, which opens a fresh connection.
  useEffect(() => {
    if (isRestarting) {
      setIsRestarting(false);
    }
  }, [isRestarting]);

  // Clear the stability timer on unmount to avoid stale ref access.
  useEffect(() => {
    return () => {
      if (stabilityTimer.current) {
        clearTimeout(stabilityTimer.current);
        stabilityTimer.current = null;
      }
    };
  }, []);

  // AppState management
  useEffect(() => {
    // App moved to the background: remember whether we were connected, pause,
    // and close the socket cleanly so it can be reopened on foreground.
    const handleBackground = () => {
      wasConnectedBeforeBackground.current = readyState === ReadyState.OPEN;
      if (!wasConnectedBeforeBackground.current) return;

      setPaused(true);
      log.info('📱 App backgrounded - closing WebSocket connection');
      const ws = getWebSocket();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'App backgrounded');
      }
    };

    // App returned to the foreground: only reconnect if we were the ones who
    // paused a previously-open connection and the hook is still enabled.
    const handleForeground = () => {
      const shouldReconnect =
        wasConnectedBeforeBackground.current &&
        isPausedRef.current &&
        isEnabled;
      if (!shouldReconnect) return;

      setPaused(false); // Re-evaluates shouldBeConnected and reconnects
      reconnectAttempts.current = 0;
      log.info('📱 App foregrounded - will reconnect WebSocket');
    };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = currentAppState.current;
      currentAppState.current = nextAppState;

      log.info(`📱 App state changed: ${previousState} → ${nextAppState}`);

      if (nextAppState === 'background' && pauseOnBackground) {
        handleBackground();
      } else if (nextAppState === 'active' && reconnectOnForeground) {
        handleForeground();
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [
    log,
    pauseOnBackground,
    reconnectOnForeground,
    readyState,
    getWebSocket,
    isEnabled,
    setPaused,
  ]);

  // Connection management functions
  const forceReconnect = useCallback(() => {
    log.info('🔄 Force reconnecting...');
    reconnectAttempts.current = 0;
    setIsManuallyDisconnected(false);
    setPaused(false);
    // Close cleanly first so the old socket's close isn't counted as a drop.
    // Shared sockets belong to react-use-websocket and can't be closed directly;
    // the restart below releases this hook's subscription instead.
    const ws = share ? null : getWebSocket();
    if (ws) {
      ws.close(1000, 'Force reconnect');
    }
    setIsRestarting(true);
  }, [getWebSocket, log, setPaused, setIsManuallyDisconnected, share]);

  const disconnect = useCallback(() => {
    log.info('🔌 Manually disconnecting...');
    setIsManuallyDisconnected(true);
    setPaused(false);
    wasConnectedBeforeBackground.current = false;
    const ws = getWebSocket();
    if (ws) {
      ws.close(1000, 'Manual disconnect');
    }
  }, [getWebSocket, log, setPaused, setIsManuallyDisconnected]);

  // New connection control functions
  const enable = useCallback(() => {
    log.info('🟢 Enabling WebSocket connection...');
    setIsEnabled(true);
    setIsManuallyDisconnected(false);
    reconnectAttempts.current = 0;
  }, [log, setIsManuallyDisconnected]);

  const disable = useCallback(() => {
    log.info('🔴 Disabling WebSocket connection...');
    setIsEnabled(false);
    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Connection disabled');
    }
  }, [getWebSocket, log]);

  // Memoize connection status
  const connectionStatus = useMemo((): string => {
    if (!isEnabled) {
      return 'Disabled';
    }
    if (isPaused) {
      return 'Paused (Background)';
    }

    const statusMap: Record<ReadyState, string> = {
      [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
      [ReadyState.CONNECTING]: 'Connecting',
      [ReadyState.OPEN]: 'Connected',
      [ReadyState.CLOSING]: 'Closing',
      [ReadyState.CLOSED]: 'Closed',
    };
    return statusMap[readyState];
  }, [readyState, isEnabled, isPaused]);

  const isConnected = useMemo(
    () => readyState === ReadyState.OPEN && !isPaused && isEnabled,
    [readyState, isEnabled, isPaused]
  );

  // Safe send functions
  const safeSendMessage = useCallback(
    (message: string): void => {
      if (isConnected) {
        sendMessage(message);
        log.info('📤 Sent:', message);
      } else {
        log.warn(`❌ Cannot send message - WebSocket is ${connectionStatus}`);
      }
    },
    [isConnected, sendMessage, connectionStatus, log]
  );

  const safeSendJsonMessage = useCallback(
    (object: TJsonMessage): void => {
      if (isConnected) {
        sendJsonMessage(object);
        log.info('📤 Sent JSON:', object);
      } else {
        log.warn(`❌ Cannot send JSON - WebSocket is ${connectionStatus}`);
      }
    },
    [isConnected, sendJsonMessage, connectionStatus, log]
  );

  // Debug state changes
  useEffect(() => {
    if (!log.enabled) return;

    const statusMap = {
      [ReadyState.UNINSTANTIATED]: 'UNINSTANTIATED',
      [ReadyState.CONNECTING]: 'CONNECTING',
      [ReadyState.OPEN]: 'OPEN',
      [ReadyState.CLOSING]: 'CLOSING',
      [ReadyState.CLOSED]: 'CLOSED',
    };

    log.info(`🔗 State: ${statusMap[readyState]}`, {
      url: url && url.length > 50 ? url.substring(0, 50) + '...' : url,
      attempts: reconnectAttempts.current,
      appState: currentAppState.current,
      isPaused,
      isEnabled,
      shouldBeConnected,
      timestamp: new Date().toISOString(),
    });
  }, [readyState, url, log, shouldBeConnected, isEnabled, isPaused]);

  return {
    sendMessage: safeSendMessage,
    sendJsonMessage: safeSendJsonMessage,
    lastMessage: lastMessage as MessageEvent<TMessageData> | null,
    lastJsonMessage,
    messageHistory,
    readyState,
    connectionStatus,
    isConnected,
    getWebSocket: () => getWebSocket() as WebSocket | null,
    debugInfo: {
      url,
      attempts: reconnectAttempts.current,
      lastError: lastError.current,
      appState: currentAppState.current,
      isPaused,
      isEnabled,
    },
    forceReconnect,
    disconnect,
    enable,
    disable,
    isEnabled,
  };
};

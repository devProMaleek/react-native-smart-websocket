import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { CustomWebSocketOptions, UseCustomWebSocketReturn } from '../types';

export const useCustomWebSocket = (
  url: string | null,
  options: CustomWebSocketOptions = {},
  initialEnabled: boolean = true,
): UseCustomWebSocketReturn => {
  const messageHistory = useRef<MessageEvent[]>([]);
  const reconnectAttempts = useRef(0);
  const lastError = useRef<string | null>(null);
  const isManuallyDisconnected = useRef(false);
  const connectionStartTime = useRef<number | null>(null);

  // Connection enabled state
  const [isEnabled, setIsEnabled] = useState(initialEnabled);

  // AppState management refs
  const currentAppState = useRef<AppStateStatus>(AppState.currentState);
  const isPausedDueToAppState = useRef(false);
  const wasConnectedBeforeBackground = useRef(false);
  const [reconnectTrigger, setReconnectTrigger] = useState<number>(0);

  const debug = useMemo(() => options.debug ?? false, [options.debug]); // Disable debug by default
  const enableHeartbeat = useMemo(
    () => options.enableHeartbeat ?? false,
    [options.enableHeartbeat],
  );
  const pauseOnBackground = useMemo(
    () => options.pauseOnBackground ?? true,
    [options.pauseOnBackground],
  );
  const reconnectOnForeground = useMemo(
    () => options.reconnectOnForeground ?? true,
    [options.reconnectOnForeground],
  );

  // Store callbacks in refs to prevent recreating WebSocket config
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Helper function to detect heartbeat messages
  const isHeartbeatMessage = useCallback(
    (data: any): boolean => {
      if (!enableHeartbeat) return false;
      if (data === '{"type":"pong"}' || data === 'pong') return true;
      if (typeof data === 'string' && data.includes('"type":"pong"'))
        return true;
      return false;
    },
    [enableHeartbeat],
  );

  // Determine if WebSocket should be active based on app state and enabled state
  const shouldBeConnected = useMemo(() => {
    if (!url) return false;
    if (!isEnabled) return false; // Don't connect if disabled
    if (isManuallyDisconnected.current) return false;
    if (pauseOnBackground && isPausedDueToAppState.current) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    url,
    isEnabled,
    pauseOnBackground,
    reconnectTrigger,
    isPausedDueToAppState.current,
  ]);

  // Create stable WebSocket configuration
  const webSocketConfig = useMemo(
    () => ({
      protocols: [],
      share: false,

      onOpen: (_event: Event) => {
        reconnectAttempts.current = 0;
        lastError.current = null;
        connectionStartTime.current = Date.now();
        isPausedDueToAppState.current = false;

        if (debug) {
          console.log('✅ WebSocket connected successfully', {
            url,
            appState: currentAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }
        callbacksRef.current.onOpen?.();
      },

      onClose: (event: CloseEvent) => {
        const connectionDuration = connectionStartTime.current
          ? Date.now() - connectionStartTime.current
          : 0;

        if (debug) {
          console.log('❌ WebSocket connection closed', {
            url,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
            connectionDuration: `${connectionDuration}ms`,
            appState: currentAppState.current,
            isPausedDueToAppState: isPausedDueToAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });

          // Enhanced close code debugging
          const closeInfo = {
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

          const reason =
            closeInfo[event.code as keyof typeof closeInfo] ||
            `❓ Unknown (${event.code})`;
          console.log(`📋 Close reason: ${reason}`);

          // Warn about very short connections (might indicate a problem)
          const isShortConnectionProblem = (
            duration: number,
            manuallyDisconnected: boolean,
            pausedDueToAppState: boolean,
          ) => {
            return (
              duration < 5000 && !manuallyDisconnected && !pausedDueToAppState
            );
          };

          if (
            isShortConnectionProblem(
              connectionDuration,
              isManuallyDisconnected.current,
              isPausedDueToAppState.current,
            )
          ) {
            console.warn(
              '⚠️ Very short connection duration - possible connection issue',
            );
          }
        }

        callbacksRef.current.onClose?.(event);
      },

      onError: (error: Event) => {
        const errorMsg = `WebSocket error: ${error.type}`;
        lastError.current = errorMsg;

        if (debug) {
          console.error('🚨 WebSocket error:', {
            url,
            errorType: error.type,
            attempts: reconnectAttempts.current,
            appState: currentAppState.current,
            isPaused: isPausedDueToAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }
        callbacksRef.current.onError?.(error);
      },

      onMessage: (message: MessageEvent) => {
        messageHistory.current = [...messageHistory.current, message];
        if (messageHistory.current.length > 50) {
          messageHistory.current = messageHistory.current.slice(-50);
        }

        const isHeartbeat = isHeartbeatMessage(message.data);

        if (debug && !isHeartbeat) {
          console.log('📨 Message received:', {
            data: message.data,
            size: `${message.data.length} chars`,
            appState: currentAppState.current,
            timestamp: new Date().toISOString(),
          });
        }

        callbacksRef.current.onMessage?.(message);
      },

      shouldReconnect: (event: CloseEvent | WebSocketEventMap['close']) => {
        // Don't reconnect if disabled
        if (!isEnabled) {
          if (debug) {
            console.log('🚫 Skipping reconnect - connection disabled');
          }
          return false;
        }

        // Don't reconnect if manually disconnected
        if (isManuallyDisconnected.current) {
          if (debug) {
            console.log('🚫 Skipping reconnect - manual disconnect');
          }
          return false;
        }

        // Don't reconnect if paused due to app state
        if (isPausedDueToAppState.current) {
          if (debug) {
            console.log('🚫 Skipping reconnect - paused due to app state');
          }
          return false;
        }

        // Don't reconnect on these specific close codes
        const noReconnectCodes = [
          1000, // Normal closure
          1001, // Going away (page unload)
          1005, // No status received
        ];

        const code = (event as CloseEvent).code ?? 1006;
        const shouldReconnect = !noReconnectCodes.includes(code);

        if (debug) {
          console.log('🔄 Reconnection decision:', {
            shouldReconnect,
            closeCode: code,
            attempts: `${reconnectAttempts.current}/5`,
            appState: currentAppState.current,
            isEnabled,
            timestamp: new Date().toISOString(),
          });
        }

        if (shouldReconnect) {
          reconnectAttempts.current += 1;
        }

        return shouldReconnect && reconnectAttempts.current < 5;
      },

      reconnectAttempts: 5,
      reconnectInterval: (attemptNumber: number) => {
        // Progressive backoff: 1s, 2s, 4s, 8s, 16s
        const baseInterval = 1000;
        const interval = Math.min(
          baseInterval * Math.pow(2, attemptNumber),
          16000,
        );

        if (debug) {
          console.log(
            `⏳ Reconnecting in ${interval}ms (attempt ${attemptNumber + 1}/5)`,
          );
        }
        return interval;
      },

      // Optional heartbeat - only if enabled
      ...(enableHeartbeat && {
        heartbeat: {
          message: JSON.stringify({ type: 'ping' }),
          returnMessage: JSON.stringify({ type: 'pong' }),
          timeout: 30000, // 30 seconds timeout
          interval: 20000, // 20 seconds interval
        },
      }),
    }),
    [enableHeartbeat, debug, url, isHeartbeatMessage, isEnabled],
  );

  const {
    sendMessage,
    sendJsonMessage,
    lastMessage,
    lastJsonMessage,
    readyState,
    getWebSocket,
  } = useWebSocket(shouldBeConnected ? url : null, webSocketConfig);

  // AppState management
  useEffect(() => {
    const logAppStateChange = (
      previousState: AppStateStatus,
      nextAppState: AppStateStatus,
    ) => {
      if (debug) {
        console.log(`📱 App state changed: ${previousState} → ${nextAppState}`);
      }
    };

    const handleBackgroundState = () => {
      wasConnectedBeforeBackground.current = readyState === ReadyState.OPEN;
      if (wasConnectedBeforeBackground.current) {
        isPausedDueToAppState.current = true;
        if (debug) {
          console.log('📱 App backgrounded - closing WebSocket connection');
        }
        const ws = getWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'App backgrounded');
        }
      }
    };

    const handleForegroundState = () => {
      const wasConnected = wasConnectedBeforeBackground.current;
      const isPaused = isPausedDueToAppState.current;
      const shouldReconnect = wasConnected && isPaused && isEnabled;

      if (shouldReconnect) {
        isPausedDueToAppState.current = false;
        reconnectAttempts.current = 0;
        setReconnectTrigger((prev) => prev + 1); // Force re-evaluation
        if (debug) {
          console.log('📱 App foregrounded - will reconnect WebSocket');
        }
      }
    };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      const previousState = currentAppState.current;
      currentAppState.current = nextAppState;

      logAppStateChange(previousState, nextAppState);

      if (nextAppState === 'background' && pauseOnBackground) {
        handleBackgroundState();
      } else if (nextAppState === 'active' && reconnectOnForeground) {
        handleForegroundState();
      }
    };

    const subscription = AppState.addEventListener(
      'change',
      handleAppStateChange,
    );

    return () => {
      subscription.remove();
    };
  }, [
    debug,
    pauseOnBackground,
    reconnectOnForeground,
    readyState,
    getWebSocket,
    isEnabled,
  ]);

  // Connection management functions
  const forceReconnect = useCallback(() => {
    if (debug) {
      console.log('🔄 Force reconnecting...');
    }
    reconnectAttempts.current = 0;
    isManuallyDisconnected.current = false;
    isPausedDueToAppState.current = false;
    const ws = getWebSocket();
    if (ws) {
      ws.close(1000, 'Force reconnect');
    }
  }, [getWebSocket, debug]);

  const disconnect = useCallback(() => {
    if (debug) {
      console.log('🔌 Manually disconnecting...');
    }
    isManuallyDisconnected.current = true;
    isPausedDueToAppState.current = false;
    wasConnectedBeforeBackground.current = false;
    const ws = getWebSocket();
    if (ws) {
      ws.close(1000, 'Manual disconnect');
    }
  }, [getWebSocket, debug]);

  // New connection control functions
  const enable = useCallback(() => {
    if (debug) {
      console.log('🟢 Enabling WebSocket connection...');
    }
    setIsEnabled(true);
    isManuallyDisconnected.current = false;
    reconnectAttempts.current = 0;
  }, [debug]);

  const disable = useCallback(() => {
    if (debug) {
      console.log('🔴 Disabling WebSocket connection...');
    }
    setIsEnabled(false);
    const ws = getWebSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, 'Connection disabled');
    }
  }, [getWebSocket, debug]);

  // Memoize connection status
  const connectionStatus = useMemo((): string => {
    if (!isEnabled) {
      return 'Disabled';
    }
    if (isPausedDueToAppState.current) {
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
  }, [readyState, isEnabled]);

  const isConnected = useMemo(
    () =>
      readyState === ReadyState.OPEN &&
      !isPausedDueToAppState.current &&
      isEnabled,
    [readyState, isEnabled],
  );

  // Safe send functions
  const safeSendMessage = useCallback(
    (message: string): void => {
      if (isConnected) {
        sendMessage(message);
        if (debug) {
          console.log('📤 Sent:', message);
        }
      } else {
        if (debug) {
          console.warn(
            `❌ Cannot send message - WebSocket is ${connectionStatus}`,
          );
        }
      }
    },
    [isConnected, sendMessage, connectionStatus, debug],
  );

  const safeSendJsonMessage = useCallback(
    (object: any): void => {
      if (isConnected) {
        sendJsonMessage(object);
        if (debug) {
          console.log('📤 Sent JSON:', object);
        }
      } else {
        if (debug) {
          console.warn(
            `❌ Cannot send JSON - WebSocket is ${connectionStatus}`,
          );
        }
      }
    },
    [isConnected, sendJsonMessage, connectionStatus, debug],
  );

  // Debug state changes
  useEffect(() => {
    if (debug) {
      const statusMap = {
        [ReadyState.UNINSTANTIATED]: 'UNINSTANTIATED',
        [ReadyState.CONNECTING]: 'CONNECTING',
        [ReadyState.OPEN]: 'OPEN',
        [ReadyState.CLOSING]: 'CLOSING',
        [ReadyState.CLOSED]: 'CLOSED',
      };

      console.log(`🔗 State: ${statusMap[readyState]}`, {
        url: url && url.length > 50 ? url.substring(0, 50) + '...' : url,
        attempts: reconnectAttempts.current,
        appState: currentAppState.current,
        isPaused: isPausedDueToAppState.current,
        isEnabled,
        shouldBeConnected,
        timestamp: new Date().toISOString(),
      });
    }
  }, [readyState, url, debug, shouldBeConnected, isEnabled]);

  return {
    sendMessage: safeSendMessage,
    sendJsonMessage: safeSendJsonMessage,
    lastMessage,
    lastJsonMessage,
    messageHistory: messageHistory.current,
    readyState,
    connectionStatus,
    isConnected,
    getWebSocket: () => getWebSocket() as WebSocket | null,
    debugInfo: {
      url,
      attempts: reconnectAttempts.current,
      lastError: lastError.current,
      appState: currentAppState.current,
      isPaused: isPausedDueToAppState.current,
      isEnabled,
    },
    forceReconnect,
    disconnect,
    enable,
    disable,
    isEnabled,
  };
};

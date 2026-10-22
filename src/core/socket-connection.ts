import type { AppStateStatus } from 'react-native';
import type {
  ConnectionStatus,
  CustomWebSocketOptions,
  QueryParams,
  WebSocketConnection,
} from '../types';
import { buildUrlWithParams } from '../utils';
import { ReadyState } from './ready-state';

/** The slice of React Native's `AppState` that a connection needs. */
export interface AppStateLike {
  currentState: AppStateStatus;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void
  ): { remove(): void };
}

export interface SocketConnectionSetup {
  id?: string;
  baseUrl: string | null;
  queryParams?: QueryParams;
  enabled?: boolean;
  options?: CustomWebSocketOptions;
  appState: AppStateLike;
}

interface ConnectionState {
  readyState: ReadyState;
  baseUrl: string | null;
  queryParams: QueryParams;
  url: string | null;
  lastMessage: MessageEvent | null;
  lastJsonMessage: unknown;
  messageHistory: MessageEvent[];
  isEnabled: boolean;
  isPaused: boolean;
  isManuallyDisconnected: boolean;
  attempts: number;
  lastError: string | null;
  appState: AppStateStatus;
}

interface HeartbeatSettings {
  message: string;
  returnMessage: string;
  interval: number;
  timeout: number;
}

const MESSAGE_HISTORY_LIMIT = 50;
// A connection must stay open this long before its reconnect attempts reset,
// so one that opens and immediately drops can't retry forever.
const STABLE_CONNECTION_MS = 5_000;
const DEFAULT_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 16_000;

// Progressive backoff: 1s, 2s, 4s, 8s, then 16s.
const defaultReconnectDelay = (attempt: number): number =>
  Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
// Close codes that mean the close was intentional, so we don't reconnect.
const NO_RECONNECT_CODES = [1000, 1001];
// Application-defined close code for a heartbeat timeout (4000–4999 range).
const HEARTBEAT_TIMEOUT_CODE = 4000;

const DEFAULT_HEARTBEAT: HeartbeatSettings = {
  message: JSON.stringify({ type: 'ping' }),
  returnMessage: JSON.stringify({ type: 'pong' }),
  interval: 10_000,
  timeout: 20_000,
};

const STATUS_BY_READY_STATE: Record<ReadyState, ConnectionStatus> = {
  [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
  [ReadyState.CONNECTING]: 'Connecting',
  [ReadyState.OPEN]: 'Connected',
  [ReadyState.CLOSING]: 'Closing',
  [ReadyState.CLOSED]: 'Closed',
};

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
  [HEARTBEAT_TIMEOUT_CODE]: '💔 Heartbeat timeout',
};

interface Logger {
  enabled: boolean;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const noop = () => undefined;
const SILENT_LOGGER: Logger = {
  enabled: false,
  info: noop,
  warn: noop,
  error: noop,
};
// Call through to console at call time so it can be stubbed in tests.
const CONSOLE_LOGGER: Logger = {
  enabled: true,
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

const parseJson = (data: unknown): unknown => {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const fullUrlOf = (
  baseUrl: string | null,
  queryParams: QueryParams
): string | null => (baseUrl ? buildUrlWithParams(baseUrl, queryParams) : null);

/**
 * Owns a single WebSocket connection: opening, reconnecting with backoff,
 * heartbeats, pausing while the app is in the background, and query params.
 * It has no React dependency; hooks read it through subscribe/getSnapshot.
 */
export class SocketConnection {
  private state: ConnectionState;
  private snapshot: WebSocketConnection;
  private options: CustomWebSocketOptions;
  private readonly id: string;
  private readonly appState: AppStateLike;
  private readonly listeners = new Set<() => void>();

  private socket: WebSocket | null = null;
  private started = false;
  private appStateSubscription: { remove(): void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private lastPingAt = 0;
  private openedAt: number | null = null;
  // Set by an error event; the close event that always follows reads it.
  private closedAfterError = false;
  private wasConnectedBeforeBackground = false;

  constructor(setup: SocketConnectionSetup) {
    const queryParams = setup.queryParams ?? {};
    this.id = setup.id ?? '';
    this.appState = setup.appState;
    this.options = setup.options ?? {};
    this.state = {
      readyState: ReadyState.UNINSTANTIATED,
      baseUrl: setup.baseUrl,
      queryParams,
      url: fullUrlOf(setup.baseUrl, queryParams),
      lastMessage: null,
      lastJsonMessage: null,
      messageHistory: [],
      isEnabled: setup.enabled ?? true,
      isPaused: false,
      isManuallyDisconnected: false,
      attempts: 0,
      lastError: null,
      appState: setup.appState.currentState,
    };
    this.snapshot = this.buildSnapshot();
  }

  // --- React integration ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** The current connection state; a new object only when something changed. */
  getSnapshot = (): WebSocketConnection => this.snapshot;

  // --- Lifecycle ---

  /** Starts listening for app state changes and opens the socket if needed. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.appStateSubscription = this.appState.addEventListener(
      'change',
      this.handleAppStateChange
    );
    this.connectIfNeeded();
  }

  /** Closes the socket and stops all timers. The connection can be started again. */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.cancelReconnect();
    if (this.retireSocket(1000, 'Connection stopped')) {
      this.setState({ readyState: ReadyState.CLOSED });
    }
  }

  // --- Configuration ---

  /** Uses the latest callbacks and settings without reconnecting. */
  setOptions(options: CustomWebSocketOptions): void {
    this.options = options;
  }

  setBaseUrl(baseUrl: string | null): void {
    if (baseUrl !== this.state.baseUrl) {
      this.changeUrl({ baseUrl });
    }
  }

  // --- Actions (stable references, exposed on the snapshot) ---

  sendMessage = (message: string): void => {
    if (this.socket && this.snapshot.isConnected) {
      this.socket.send(message);
      this.log.info('📤 Sent:', message);
    } else {
      this.log.warn(
        `❌ Cannot send message - WebSocket is ${this.snapshot.connectionStatus}`
      );
    }
  };

  sendJsonMessage = (message: unknown): void => {
    if (this.socket && this.snapshot.isConnected) {
      this.socket.send(JSON.stringify(message));
      this.log.info('📤 Sent JSON:', message);
    } else {
      this.log.warn(
        `❌ Cannot send JSON - WebSocket is ${this.snapshot.connectionStatus}`
      );
    }
  };

  getWebSocket = (): WebSocket | null => this.socket;

  enable = (): void => {
    this.log.info('🟢 Enabling WebSocket connection...');
    this.setState({
      isEnabled: true,
      isManuallyDisconnected: false,
      // An explicit enable lifts a leftover background pause, but only once
      // the app is back in the foreground.
      ...(this.state.appState !== 'background' && { isPaused: false }),
      attempts: 0,
    });
    this.connectIfNeeded();
  };

  disable = (): void => {
    this.log.info('🔴 Disabling WebSocket connection...');
    this.cancelReconnect();
    const hadSocket = this.retireSocket(1000, 'Connection disabled');
    this.setState({
      isEnabled: false,
      ...(hadSocket && { readyState: ReadyState.CLOSED }),
    });
  };

  disconnect = (): void => {
    this.log.info('🔌 Manually disconnecting...');
    this.cancelReconnect();
    this.wasConnectedBeforeBackground = false;
    const hadSocket = this.retireSocket(1000, 'Manual disconnect');
    this.setState({
      isManuallyDisconnected: true,
      isPaused: false,
      ...(hadSocket && { readyState: ReadyState.CLOSED }),
    });
  };

  forceReconnect = (): void => {
    this.log.info('🔄 Force reconnecting...');
    this.cancelReconnect();
    const hadSocket = this.retireSocket(1000, 'Force reconnect');
    this.setState({
      isManuallyDisconnected: false,
      isPaused: false,
      attempts: 0,
      ...(hadSocket && { readyState: ReadyState.CLOSED }),
    });
    this.connectIfNeeded();
  };

  updateQueryParams = (params: QueryParams): void => {
    this.changeUrl({ queryParams: { ...this.state.queryParams, ...params } });
  };

  clearQueryParams = (): void => {
    this.changeUrl({ queryParams: {} });
  };

  // --- Socket management ---

  private shouldBeConnected(): boolean {
    const { url, isEnabled, isManuallyDisconnected, isPaused } = this.state;
    return (
      this.started &&
      url !== null &&
      isEnabled &&
      !isManuallyDisconnected &&
      !isPaused
    );
  }

  private connectIfNeeded(): void {
    if (!this.socket && !this.reconnectTimer && this.shouldBeConnected()) {
      this.openSocket();
    }
  }

  private openSocket(): void {
    const { url } = this.state;
    if (!url) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url, this.options.protocols);
    } catch (error) {
      // An invalid URL throws synchronously; retrying wouldn't help.
      this.log.error('🚨 Could not create WebSocket:', error);
      this.setState({
        readyState: ReadyState.CLOSED,
        lastError: `WebSocket error: ${String(error)}`,
      });
      return;
    }

    this.socket = socket;
    this.openedAt = null;
    this.closedAfterError = false;
    socket.onopen = (event) => {
      if (socket === this.socket) this.handleOpen(event);
    };
    socket.onmessage = (event) => {
      if (socket === this.socket) this.handleMessage(event);
    };
    socket.onerror = (event) => {
      if (socket === this.socket) this.handleError(event);
    };
    socket.onclose = (event) => {
      if (socket === this.socket) {
        this.handleClose(event);
      } else {
        // A socket we closed on purpose: report it, but it can't change state.
        this.options.onClose?.(event);
      }
    };
    this.setState({ readyState: ReadyState.CONNECTING });
  }

  /**
   * Detaches the current socket so its remaining events can't affect state,
   * then closes it. Returns whether there was a socket to retire.
   */
  private retireSocket(code: number, reason: string): boolean {
    const socket = this.socket;
    if (!socket) {
      return false;
    }
    this.socket = null;
    this.stopHeartbeat();
    this.clearStabilityTimer();
    if (socket.readyState === ReadyState.CONNECTING) {
      // React Native on Android ignores close() until the socket has opened,
      // so close it again once it does rather than leave it connected.
      socket.onopen = () => socket.close(code, reason);
    }
    if (
      socket.readyState === ReadyState.CONNECTING ||
      socket.readyState === ReadyState.OPEN
    ) {
      socket.close(code, reason);
    }
    return true;
  }

  private changeUrl(
    patch: Partial<Pick<ConnectionState, 'baseUrl' | 'queryParams'>>
  ): void {
    const baseUrl =
      patch.baseUrl !== undefined ? patch.baseUrl : this.state.baseUrl;
    const queryParams = patch.queryParams ?? this.state.queryParams;
    const url = fullUrlOf(baseUrl, queryParams);
    const urlChanged = url !== this.state.url;
    this.setState({ baseUrl, queryParams, url });
    if (!urlChanged || !this.started) {
      return;
    }

    // A deliberate URL change: replace the socket without spending a
    // reconnect attempt.
    this.cancelReconnect();
    const hadSocket = this.retireSocket(1000, 'URL changed');
    this.setState({
      attempts: 0,
      ...(hadSocket && { readyState: ReadyState.CLOSED }),
    });
    this.connectIfNeeded();
  }

  // --- Socket events ---

  private handleOpen(event: Event): void {
    this.openedAt = Date.now();
    this.clearStabilityTimer();
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null;
      this.setState({ attempts: 0 });
    }, STABLE_CONNECTION_MS);
    this.startHeartbeat();
    this.setState({
      readyState: ReadyState.OPEN,
      lastError: null,
      isPaused: false,
    });

    if (this.log.enabled) {
      this.log.info('✅ WebSocket connected successfully', {
        url: this.state.url,
        appState: this.state.appState,
        timestamp: new Date().toISOString(),
      });
    }
    this.options.onOpen?.(event);
  }

  private handleMessage(event: MessageEvent): void {
    this.lastMessageAt = Date.now();

    // Heartbeat replies prove the connection is alive but aren't app data.
    if (!this.isHeartbeatReply(event.data)) {
      this.setState({
        lastMessage: event,
        lastJsonMessage: parseJson(event.data),
        messageHistory: [...this.state.messageHistory, event].slice(
          -MESSAGE_HISTORY_LIMIT
        ),
      });

      if (this.log.enabled) {
        this.log.info('📨 Message received:', {
          data: event.data,
          appState: this.state.appState,
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.options.onMessage?.(event);
  }

  private handleError(event: Event): void {
    this.closedAfterError = true;
    this.setState({ lastError: `WebSocket error: ${event.type}` });

    if (this.log.enabled) {
      this.log.error('🚨 WebSocket error:', {
        url: this.state.url,
        errorType: event.type,
        attempts: this.state.attempts,
        appState: this.state.appState,
        timestamp: new Date().toISOString(),
      });
    }
    this.options.onError?.(event);
  }

  private handleClose(event: CloseEvent): void {
    this.socket = null;
    this.stopHeartbeat();
    this.clearStabilityTimer();
    const followedError = this.closedAfterError;
    this.closedAfterError = false;
    this.setState({ readyState: ReadyState.CLOSED });

    if (this.log.enabled) {
      this.logClose(event);
    }
    this.options.onClose?.(event);

    if (this.shouldReconnect(event.code, followedError)) {
      this.scheduleReconnect();
    }
  }

  // --- Reconnection ---

  private shouldReconnect(code: number, followedError: boolean): boolean {
    const { enableReconnect = true, retryOnError = true } = this.options;

    if (!enableReconnect) {
      this.log.info('🚫 Skipping reconnect - reconnect disabled');
      return false;
    }
    if (followedError && !retryOnError) {
      this.log.info('🚫 Skipping reconnect - error and retryOnError is off');
      return false;
    }
    if (!this.shouldBeConnected()) {
      this.log.info('🚫 Skipping reconnect - connection disabled or paused');
      return false;
    }
    if (NO_RECONNECT_CODES.includes(code)) {
      this.log.info(`🚫 Skipping reconnect - close code ${code}`);
      return false;
    }
    if (this.state.attempts >= this.maxReconnectAttempts()) {
      this.log.warn(
        `🛑 Giving up after ${this.state.attempts} reconnect attempts`
      );
      return false;
    }
    return true;
  }

  private maxReconnectAttempts(): number {
    return this.options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
  }

  private reconnectDelay(attempt: number): number {
    const { reconnectInterval } = this.options;
    if (typeof reconnectInterval === 'function') {
      return reconnectInterval(attempt);
    }
    return reconnectInterval ?? defaultReconnectDelay(attempt);
  }

  private scheduleReconnect(): void {
    const attempt = this.state.attempts + 1;
    const delay = this.reconnectDelay(attempt);
    this.setState({ attempts: attempt });
    this.log.info(
      `⏳ Reconnecting in ${delay}ms (attempt ${attempt}/${this.maxReconnectAttempts()})`
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectIfNeeded();
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  // --- Heartbeat ---

  private heartbeatSettings(): HeartbeatSettings | null {
    const { enableHeartbeat } = this.options;
    if (!enableHeartbeat) {
      return null;
    }
    if (enableHeartbeat === true) {
      return DEFAULT_HEARTBEAT;
    }
    return {
      message: enableHeartbeat.message ?? DEFAULT_HEARTBEAT.message,
      returnMessage:
        enableHeartbeat.returnMessage ?? DEFAULT_HEARTBEAT.returnMessage,
      interval: enableHeartbeat.interval ?? DEFAULT_HEARTBEAT.interval,
      timeout: enableHeartbeat.timeout ?? DEFAULT_HEARTBEAT.timeout,
    };
  }

  private isHeartbeatReply(data: unknown): boolean {
    const heartbeat = this.heartbeatSettings();
    return heartbeat !== null && data === heartbeat.returnMessage;
  }

  private startHeartbeat(): void {
    const heartbeat = this.heartbeatSettings();
    if (!heartbeat) {
      return;
    }
    this.stopHeartbeat();
    this.lastMessageAt = Date.now();
    this.lastPingAt = this.lastMessageAt;
    this.heartbeatTimer = setInterval(
      () => this.checkHeartbeat(heartbeat),
      Math.max(100, heartbeat.interval / 10)
    );
  }

  private checkHeartbeat(heartbeat: HeartbeatSettings): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    const now = Date.now();
    const silentFor = now - this.lastMessageAt;

    if (silentFor >= heartbeat.timeout) {
      this.log.warn(`💔 Heartbeat timed out after ${silentFor}ms`);
      this.failHeartbeat('Heartbeat timeout');
      return;
    }

    if (
      silentFor >= heartbeat.interval &&
      now - this.lastPingAt >= heartbeat.interval
    ) {
      try {
        socket.send(heartbeat.message);
        this.lastPingAt = now;
      } catch (error) {
        this.log.error('💔 Heartbeat ping failed', error);
        this.failHeartbeat('Heartbeat failed');
      }
    }
  }

  // A dead server may never complete the close handshake, so don't wait for
  // the close event: retire the socket and decide on a reconnect right away.
  private failHeartbeat(reason: string): void {
    this.retireSocket(HEARTBEAT_TIMEOUT_CODE, reason);
    this.setState({ readyState: ReadyState.CLOSED });
    if (this.shouldReconnect(HEARTBEAT_TIMEOUT_CODE, false)) {
      this.scheduleReconnect();
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // --- App state ---

  private handleAppStateChange = (next: AppStateStatus): void => {
    const previous = this.state.appState;
    this.setState({ appState: next });
    this.log.info(`📱 App state changed: ${previous} → ${next}`);

    const { pauseOnBackground = true, reconnectOnForeground = true } =
      this.options;
    if (next === 'background' && pauseOnBackground) {
      this.pauseForBackground();
    } else if (next === 'active' && reconnectOnForeground) {
      this.resumeFromBackground();
    }
  };

  // Close an open socket while backgrounded so it can be reopened on return.
  private pauseForBackground(): void {
    this.wasConnectedBeforeBackground =
      this.state.readyState === ReadyState.OPEN;
    if (!this.wasConnectedBeforeBackground) {
      return;
    }
    this.log.info('📱 App backgrounded - closing WebSocket connection');
    this.cancelReconnect();
    this.retireSocket(1000, 'App backgrounded');
    this.setState({ isPaused: true, readyState: ReadyState.CLOSED });
  }

  // Only reopen a connection we paused ourselves, and only if still enabled.
  private resumeFromBackground(): void {
    const { isPaused, isEnabled } = this.state;
    if (!this.wasConnectedBeforeBackground || !isPaused || !isEnabled) {
      return;
    }
    this.log.info('📱 App foregrounded - will reconnect WebSocket');
    this.setState({ isPaused: false, attempts: 0 });
    this.connectIfNeeded();
  }

  // --- State ---

  private get log(): Logger {
    return this.options.debug ? CONSOLE_LOGGER : SILENT_LOGGER;
  }

  private setState(patch: Partial<ConnectionState>): void {
    const changed = (Object.keys(patch) as (keyof ConnectionState)[]).some(
      (key) => !Object.is(patch[key], this.state[key])
    );
    if (!changed) {
      return;
    }
    this.state = { ...this.state, ...patch };
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
  }

  private buildSnapshot(): WebSocketConnection {
    const {
      readyState,
      url,
      queryParams,
      lastMessage,
      lastJsonMessage,
      messageHistory,
      isEnabled,
      isPaused,
      attempts,
      lastError,
      appState,
    } = this.state;

    return {
      id: this.id,
      url,
      readyState,
      connectionStatus: !isEnabled
        ? 'Disabled'
        : isPaused
          ? 'Paused (Background)'
          : STATUS_BY_READY_STATE[readyState],
      isConnected: readyState === ReadyState.OPEN && isEnabled && !isPaused,
      isEnabled,
      lastMessage: lastMessage as MessageEvent<string> | null,
      lastJsonMessage,
      messageHistory: messageHistory as MessageEvent<string>[],
      currentParams: queryParams,
      debugInfo: { url, attempts, lastError, appState, isPaused, isEnabled },
      sendMessage: this.sendMessage,
      sendJsonMessage: this.sendJsonMessage,
      getWebSocket: this.getWebSocket,
      forceReconnect: this.forceReconnect,
      disconnect: this.disconnect,
      enable: this.enable,
      disable: this.disable,
      updateQueryParams: this.updateQueryParams,
      clearQueryParams: this.clearQueryParams,
    };
  }

  private logClose(event: CloseEvent): void {
    const connectionDuration = this.openedAt ? Date.now() - this.openedAt : 0;
    this.log.info('❌ WebSocket connection closed', {
      url: this.state.url,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      connectionDuration: `${connectionDuration}ms`,
      appState: this.state.appState,
      timestamp: new Date().toISOString(),
    });
    this.log.info(
      `📋 Close reason: ${CLOSE_CODE_INFO[event.code] || `❓ Unknown (${event.code})`}`
    );
    // A very short-lived connection usually points at a server or auth issue.
    if (connectionDuration < STABLE_CONNECTION_MS) {
      this.log.warn(
        '⚠️ Very short connection duration - possible connection issue'
      );
    }
  }
}

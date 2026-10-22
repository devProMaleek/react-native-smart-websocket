import type { WebSocketConfig, WebSocketConnection } from '../types';
import { type AppStateLike, SocketConnection } from './socket-connection';

/**
 * Keeps one SocketConnection per configured id. Connections are siblings
 * rather than nested components, so adding or removing one never disturbs
 * the others, and each can be subscribed to on its own.
 */
export class ConnectionManager {
  private readonly connections = new Map<string, SocketConnection>();
  private readonly unsubscribes = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();
  private snapshot: Map<string, WebSocketConnection> | null = null;
  private membershipChanged = false;

  constructor(private readonly appState: AppStateLike) {}

  /**
   * Creates idle connections for any new ids so they can be read on the first
   * render. Safe to call while rendering: it never opens sockets or notifies.
   */
  ensure(configs: WebSocketConfig[]): void {
    for (const config of configs) {
      if (!this.connections.has(config.id)) {
        this.add(config);
      }
    }
  }

  /**
   * Applies the latest configs: starts new connections, passes updated URLs
   * and options to existing ones, and stops removed ones. Call from an effect.
   */
  sync(configs: WebSocketConfig[]): void {
    const ids = new Set(configs.map((config) => config.id));
    for (const id of [...this.connections.keys()]) {
      if (!ids.has(id)) {
        this.remove(id);
      }
    }

    for (const config of configs) {
      const connection = this.connections.get(config.id) ?? this.add(config);
      connection.setOptions(config.options ?? {});
      connection.setBaseUrl(config.baseUrl);
      connection.start();
    }

    if (this.membershipChanged) {
      this.membershipChanged = false;
      this.invalidate();
    }
  }

  /** Stops every connection, e.g. when the provider unmounts. */
  stopAll(): void {
    this.connections.forEach((connection) => connection.stop());
  }

  get(id: string): SocketConnection | undefined {
    return this.connections.get(id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Every connection's current state; a new Map only when something changed. */
  getConnectionsSnapshot = (): Map<string, WebSocketConnection> => {
    if (!this.snapshot) {
      this.snapshot = new Map(
        [...this.connections].map(([id, connection]) => [
          id,
          connection.getSnapshot(),
        ])
      );
    }
    return this.snapshot;
  };

  private add(config: WebSocketConfig): SocketConnection {
    const connection = new SocketConnection({
      id: config.id,
      baseUrl: config.baseUrl,
      queryParams: config.initialQueryParams,
      enabled: config.initialEnabled ?? false,
      options: config.options,
      appState: this.appState,
    });
    this.connections.set(config.id, connection);
    this.unsubscribes.set(config.id, connection.subscribe(this.invalidate));
    this.snapshot = null;
    this.membershipChanged = true;
    return connection;
  }

  private remove(id: string): void {
    this.connections.get(id)?.stop();
    this.unsubscribes.get(id)?.();
    this.unsubscribes.delete(id);
    this.connections.delete(id);
    this.snapshot = null;
    this.membershipChanged = true;
  }

  private invalidate = (): void => {
    this.snapshot = null;
    this.listeners.forEach((listener) => listener());
  };
}

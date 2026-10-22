type CloseListener = (event: CloseEvent) => void;

/**
 * A controllable stand-in for the global WebSocket. react-use-websocket binds
 * `onopen` / `onmessage` / `onerror` / `onclose` (plus a `close` listener for
 * heartbeats), so that's the surface implemented here. Tests play the server's
 * part through open(), receive(), fail() and serverClose().
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  /** The most recently created socket. */
  static latest(): FakeWebSocket {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) {
      throw new Error('No FakeWebSocket has been created yet');
    }
    return socket;
  }

  /** Every socket created for a URL, oldest first. */
  static forUrl(url: string): FakeWebSocket[] {
    return FakeWebSocket.instances.filter((socket) => socket.url === url);
  }

  readonly url: string;
  readonly protocols?: string | string[];
  readyState: number = FakeWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason: string }> = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private readonly closeListeners = new Set<CloseListener>();

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error(
        'FakeWebSocket: send() called while the socket is not open'
      );
    }
    this.sent.push(data);
  }

  close(code?: number, reason = ''): void {
    this.closeCalls.push({ code, reason });
    if (
      this.readyState === FakeWebSocket.CLOSING ||
      this.readyState === FakeWebSocket.CLOSED
    ) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSING;
    // Like a real socket, the close event arrives asynchronously. Browsers
    // report 1005 ("no status received") when close() is called without a code.
    void Promise.resolve().then(() => {
      this.readyState = FakeWebSocket.CLOSED;
      this.dispatchClose(code ?? 1005, reason, true);
    });
  }

  addEventListener(type: string, listener: CloseListener): void {
    if (type === 'close') {
      this.closeListeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: CloseListener): void {
    if (type === 'close') {
      this.closeListeners.delete(listener);
    }
  }

  // --- Test controls: simulate the server / network ---

  /** The server accepts the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  /** The server sends a message. */
  receive(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /**
   * The connection fails (server unreachable, network lost). Browsers and
   * React Native report this as an `error` event followed by `close` (1006).
   */
  fail(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onerror?.(new Event('error'));
    this.dispatchClose(1006, '', false);
  }

  /** The server closes the connection with the given code. */
  serverClose(code: number, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchClose(code, reason, code === 1000);
  }

  private dispatchClose(code: number, reason: string, wasClean: boolean): void {
    const event = new CloseEvent('close', { code, reason, wasClean });
    this.onclose?.(event);
    this.closeListeners.forEach((listener) => listener(event));
  }
}

/**
 * Connection states. Values match `WebSocket.readyState`, plus
 * `UNINSTANTIATED` for a connection that hasn't opened a socket yet.
 */
export enum ReadyState {
  UNINSTANTIATED = -1,
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

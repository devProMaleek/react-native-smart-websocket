# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking changes

- `react-use-websocket` has been replaced by a built-in connection layer, so the package has no runtime dependencies. It required `react-dom` without declaring it, which React Native apps without `react-dom` couldn't resolve.
- `CustomWebSocketOptions` no longer extends react-use-websocket's `Options`. Those extra options were accepted by the types but ignored.
- The `share` option has been removed. Use `WebSocketManagerProvider` to share one connection across components.
- React 18+ and React Native 0.69+ are now required.
- `lastJsonMessage` is `null` (instead of `{}`) when a message isn't valid JSON.

### Added

- `ReadyState` is exported from the package, and `connectionStatus` is typed as a `ConnectionStatus` union.
- `protocols` option for requesting WebSocket subprotocols.
- `reconnectAttempts` and `reconnectInterval` options to tune reconnection. The defaults are unchanged: 5 attempts with a 1s→16s backoff.
- `enableHeartbeat` accepts an object to customize the ping and pong messages, the ping interval and the timeout.

### Changed

- Adding or removing connections in `WebSocketManagerProvider` no longer reconnects the other connections.
- Changing a connection's URL or query params replaces its socket without using up a reconnect attempt.
- Connection methods (`sendMessage`, `enable`, `updateQueryParams`, …) keep the same identity across renders, and messages sent from `onOpen` are delivered.
- The reconnect delay now also backs off for connections that open and then drop quickly, instead of retrying every second.
- A heartbeat timeout closes the socket with code 4000 before reconnecting.

## [1.0.1] - 2026-10-22

### Fixed

- Connection errors (for example, an unreachable server) now respect the 5-attempt reconnect limit and `enableReconnect: false`. Previously an error could trigger up to 20 reconnects, even with reconnection disabled. `retryOnError` now decides whether a connection error is retried, within the same limit.
- `forceReconnect()` now replaces an open connection with a fresh one. Previously it closed the socket and left it closed.
- With `enableHeartbeat`, pong replies are no longer added to `messageHistory` (they were already excluded from `lastMessage`), so they don't push real messages out of the 50-message history.

## [1.0.0] - 2026-06-04

### Added

- Initial release.
- `WebSocketManagerProvider` for declaring and managing multiple named WebSocket connections from a single provider.
- `useWebSocket(id)` hook to read an isolated, per-connection context anywhere in the tree.
- `useWebSocketManager()` hook to access all managed connections.
- `useCustomWebSocket()` low-level hook for standalone single-connection usage.
- Mobile-optimized behavior: `pauseOnBackground`, `reconnectOnForeground`, and optional heartbeat keep-alive.
- Progressive reconnection backoff with configurable attempts.
- Runtime query-parameter management (`updateQueryParams`, `clearQueryParams`) and connection control (`enable`, `disable`, `forceReconnect`, `disconnect`).
- TypeScript type declarations shipped with the package.

[Unreleased]: https://github.com/devProMaleek/react-native-smart-websocket/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/devProMaleek/react-native-smart-websocket/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/devProMaleek/react-native-smart-websocket/releases/tag/v1.0.0

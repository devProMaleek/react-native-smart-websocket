# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/devProMaleek/react-native-smart-websocket/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/devProMaleek/react-native-smart-websocket/releases/tag/v1.0.0

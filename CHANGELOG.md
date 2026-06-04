# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/devProMaleek/react-native-smart-websocket/releases/tag/v1.0.0

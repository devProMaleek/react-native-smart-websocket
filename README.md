# react-native-smart-websocket

> Smart WebSocket management for React Native — one manager for every WebSocket in your app, with mobile-optimized reconnection and background handling.

[![npm version](https://img.shields.io/npm/v/react-native-smart-websocket.svg)](https://www.npmjs.com/package/react-native-smart-websocket)
[![license](https://img.shields.io/npm/l/react-native-smart-websocket.svg)](./LICENSE)

Instead of wrapping your app in a separate provider for every socket, you declare **all** of your named connections in a single `WebSocketManagerProvider`. Each connection gets its own isolated context, and any component reads the one it needs with `useWebSocket('connection-id')`.

## Features

- **One manager, many connections** — declare every named socket in a single provider.
- **Per-connection context** — each connection gets its own React context, so a message on one connection only re-renders components reading _that_ connection.
- **Mobile-aware** — pause sockets when the app goes to the background and reconnect on foreground (`pauseOnBackground`, `reconnectOnForeground`).
- **Resilient reconnection** — progressive backoff (1s → 2s → 4s → 8s → 16s), capped at 5 attempts; the counter only resets after a connection stays stable for 5s, so flapping connections don't retry forever.
- **Optional heartbeat** — ping/pong keep-alive (`enableHeartbeat`).
- **Dynamic query params** — update or clear a connection's query string at runtime, triggering a reconnect.
- **Connection control** — `enable()` / `disable()`, `forceReconnect()`, `disconnect()`.
- **JSON & string messaging**, last-message tracking, and message history.
- **Fully typed** — written in TypeScript, ships with type declarations.

## Installation

```sh
npm install react-native-smart-websocket
# or
yarn add react-native-smart-websocket
```

`react` and `react-native` are peer dependencies (React `>=16.8.0`, React Native `>=0.60.0`). `react-use-websocket` is bundled as a dependency — you do not need to install it separately.

> **Query params on older React Native:** dynamic query parameters are built with the global `URL` API. Recent React Native ships a usable `URL`, and this library falls back to manual query-string assembly if `URL.searchParams` is incomplete. For the most reliable behavior on older RN versions, install [`react-native-url-polyfill`](https://github.com/charpeni/react-native-url-polyfill) and import it once at your app entry:
>
> ```js
> import 'react-native-url-polyfill/auto';
> ```

## Quick start

### 1. Wrap your app with the provider

Declare every socket your app uses in the `connections` array.

```tsx
import { WebSocketManagerProvider } from 'react-native-smart-websocket';

export default function App() {
  return (
    <WebSocketManagerProvider
      connections={[
        {
          id: 'chat',
          baseUrl: 'wss://example.com/chat',
          initialQueryParams: { room: 'general' },
          initialEnabled: true,
          options: {
            pauseOnBackground: true,
            reconnectOnForeground: true,
            enableHeartbeat: true,
            debug: __DEV__,
          },
        },
        {
          id: 'notifications',
          baseUrl: 'wss://example.com/notifications',
          // initialEnabled defaults to false — connect later with enable()
        },
      ]}
    >
      <RootNavigator />
    </WebSocketManagerProvider>
  );
}
```

### 2. Read a named connection anywhere

```tsx
import { useWebSocket } from 'react-native-smart-websocket';

function ChatScreen() {
  const chat = useWebSocket('chat');

  return (
    <View>
      <Text>Status: {chat.connectionStatus}</Text>

      <Button
        title="Send"
        onPress={() => chat.sendJsonMessage({ type: 'message', text: 'Hello!' })}
      />

      {chat.lastJsonMessage && (
        <Text>Latest: {JSON.stringify(chat.lastJsonMessage)}</Text>
      )}
    </View>
  );
}
```

### Typed messages

`lastJsonMessage` defaults to `unknown` (it's untrusted network data — narrow before use). Pass a type argument to `useWebSocket` to type both sending and receiving:

```tsx
type TimelineEvent = { type: 'tick'; value: number };

const timeline = useWebSocket<TimelineEvent>('timeline');

timeline.lastJsonMessage; // TimelineEvent | null
timeline.sendJsonMessage({ type: 'tick', value: 1 }); // only accepts TimelineEvent
```

### 3. Control connections at runtime

```tsx
const notifications = useWebSocket('notifications');

// Connect / disconnect on demand
notifications.enable();
notifications.disable();

// Force a reconnect
notifications.forceReconnect();

// Update query params (reconnects with the new URL when enabled)
notifications.updateQueryParams({ token: 'abc123' });
notifications.clearQueryParams();
```

## Example: a full app with several connections

This walks through a small app that uses **four** sockets at once — `chat`, `notifications`, `presence`, and `orders` — to show the patterns you'll reuse. New to the library? Read it top to bottom; each step builds on the last.

### 1. Declare every socket in one provider

Define all your connections once. A shared `options` object (memoized so the config stays stable) keeps things DRY, and you can override per connection.

```tsx
// app-websocket-provider.tsx
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { WebSocketManagerProvider } from 'react-native-smart-websocket';

const WS_BASE = 'wss://api.example.com';

export function AppWebSocketProvider({ children }: { children: ReactNode }) {
  // Defaults applied to every connection.
  const sharedOptions = useMemo(
    () => ({
      debug: __DEV__, // verbose logs in development only
      enableReconnect: true,
      pauseOnBackground: true,
      reconnectOnForeground: true,
    }),
    []
  );

  return (
    <WebSocketManagerProvider
      connections={[
        // Live chat — connect right away, keep alive with a heartbeat.
        {
          id: 'chat',
          baseUrl: `${WS_BASE}/chat`,
          initialQueryParams: { room: 'general' },
          initialEnabled: true,
          options: { ...sharedOptions, enableHeartbeat: true },
        },
        // Notifications — connect right away.
        {
          id: 'notifications',
          baseUrl: `${WS_BASE}/notifications`,
          initialEnabled: true,
          options: sharedOptions,
        },
        // Presence / online status.
        {
          id: 'presence',
          baseUrl: `${WS_BASE}/presence`,
          initialQueryParams: { status: 'online' },
          initialEnabled: true,
          options: sharedOptions,
        },
        // Order updates — only needed after sign-in, so start disabled
        // and turn it on later with enable().
        {
          id: 'orders',
          baseUrl: `${WS_BASE}/orders`,
          initialEnabled: false,
          options: sharedOptions,
        },
      ]}
    >
      {children}
    </WebSocketManagerProvider>
  );
}
```

Wrap your app with it once, at the root:

```tsx
// App.tsx
export default function App() {
  return (
    <AppWebSocketProvider>
      <RootNavigator />
    </AppWebSocketProvider>
  );
}
```

### 2. Describe your message shapes (optional but recommended)

Typing each connection's messages gives you autocomplete and catches typos.

```tsx
// ws-types.ts
export type ChatMessage = { type: 'message'; user: string; text: string };
export type Notification = { type: 'notification'; title: string; body: string };
export type OrderUpdate = {
  type: 'order';
  orderId: string;
  status: 'pending' | 'shipped' | 'delivered';
};
```

### 3. Read each connection where you need it

Any component can grab a connection by id with `useWebSocket`. A component only re-renders when **its** connection updates.

```tsx
import { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { useWebSocket } from 'react-native-smart-websocket';
import type { ChatMessage } from './ws-types';

function ChatScreen() {
  const chat = useWebSocket<ChatMessage>('chat');
  const [text, setText] = useState('');

  return (
    <View>
      <Text>Status: {chat.connectionStatus}</Text>

      {chat.lastJsonMessage && (
        <Text>
          {chat.lastJsonMessage.user}: {chat.lastJsonMessage.text}
        </Text>
      )}

      <TextInput value={text} onChangeText={setText} placeholder="Message" />
      <Button
        title="Send"
        onPress={() => {
          chat.sendJsonMessage({ type: 'message', user: 'me', text });
          setText('');
        }}
      />
    </View>
  );
}
```

A tiny notifications badge, reading a different connection:

```tsx
import { Text } from 'react-native';
import { useWebSocket } from 'react-native-smart-websocket';
import type { Notification } from './ws-types';

function NotificationBadge() {
  const { lastJsonMessage } = useWebSocket<Notification>('notifications');
  if (!lastJsonMessage) return null;
  return <Text>🔔 {lastJsonMessage.title}</Text>;
}
```

### 4. Turn a connection on after sign-in

The `orders` socket started disabled. Enable it once the user logs in (and disable it on logout). Destructure `enable`/`disable` — they're stable, so the effect runs only when the login state changes.

```tsx
import { useEffect } from 'react';
import { useWebSocket } from 'react-native-smart-websocket';
import type { OrderUpdate } from './ws-types';

function useOrdersSocket(isLoggedIn: boolean) {
  const orders = useWebSocket<OrderUpdate>('orders');
  const { enable, disable } = orders;

  useEffect(() => {
    if (isLoggedIn) {
      enable();
    } else {
      disable();
    }
  }, [isLoggedIn, enable, disable]);

  return orders;
}
```

### 5. Change query params at runtime

`presence` connected with `status=online`. Push the signed-in user's id onto the URL when it's known — the socket reconnects with the new query string automatically.

```tsx
import { useEffect } from 'react';
import { useWebSocket } from 'react-native-smart-websocket';

function PresenceSync({ userId }: { userId: string }) {
  const { updateQueryParams } = useWebSocket('presence');

  useEffect(() => {
    updateQueryParams({ userId });
  }, [userId, updateQueryParams]);

  return null; // this component just syncs params
}
```

### 6. See every connection at a glance

`useWebSocketManager()` exposes all connections — handy for a debug/status panel.

```tsx
import { View, Text } from 'react-native';
import { useWebSocketManager } from 'react-native-smart-websocket';

function ConnectionMonitor() {
  const { connections } = useWebSocketManager();

  return (
    <View>
      {Array.from(connections.values()).map((c) => (
        <Text key={c.id}>
          {c.id}: {c.connectionStatus} {c.isConnected ? '🟢' : '🔴'}
        </Text>
      ))}
    </View>
  );
}
```

That's the whole flow: declare your sockets once, read them anywhere by id, control them at runtime, and let the library handle reconnection and background/foreground for you.

## API

### `WebSocketManagerProvider`

| Prop          | Type                  | Description                                  |
| ------------- | --------------------- | -------------------------------------------- |
| `children`    | `ReactNode`           | Your app tree.                               |
| `connections` | `WebSocketConfig[]`   | The list of named connections to manage.     |

### `WebSocketConfig`

| Field                | Type                                              | Default | Description                                            |
| -------------------- | ------------------------------------------------- | ------- | ------------------------------------------------------ |
| `id`                 | `string`                                          | —       | Unique identifier used to read the connection.         |
| `baseUrl`            | `string \| null`                                  | —       | The WebSocket URL (without dynamic query params).      |
| `initialQueryParams` | `Record<string, string \| number \| boolean>`     | `{}`    | Query params appended to `baseUrl`.                    |
| `initialEnabled`     | `boolean`                                          | `false` | Whether to connect immediately.                        |
| `options`            | `CustomWebSocketOptions`                           | `{}`    | Per-connection behavior (see below).                   |

### `CustomWebSocketOptions`

Extends [`react-use-websocket`](https://github.com/robtaussig/react-use-websocket) `Options`, plus:

| Option                  | Type                              | Description                                            |
| ----------------------- | --------------------------------- | ------------------------------------------------------ |
| `pauseOnBackground`     | `boolean`                         | Pause the socket when the app backgrounds. Default `true`. |
| `reconnectOnForeground` | `boolean`                         | Reconnect when the app returns to the foreground. Default `true`. |
| `enableReconnect`       | `boolean`                         | Automatically reconnect on unexpected close. Default `true`. |
| `retryOnError`          | `boolean`                         | Retry the connection when an error occurs. Default `true`. |
| `enableHeartbeat`       | `boolean`                         | Enable ping/pong keep-alive (10s interval / 20s timeout). Default `false`. |
| `share`                 | `boolean`                         | Share one socket across hooks with the same URL. Default `false`. |
| `debug`                 | `boolean`                         | Verbose console logging. Default `false`.              |
| `onOpen`                | `() => void`                      | Called on open.                                        |
| `onClose`               | `(event?: CloseEvent) => void`    | Called on close.                                       |
| `onError`               | `(error: Event) => void`          | Called on error.                                       |
| `onMessage`             | `(message: MessageEvent) => void` | Called on every message.                               |

### Hooks

| Hook                            | Returns                        | Description                                                       |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `useWebSocket(id)`              | `WebSocketConnection`          | Read a named connection from the provider.                        |
| `useWebSocketManager()`         | `WebSocketManagerContextType`  | Access all connections (useful for debugging/monitoring).         |
| `useCustomWebSocket(url, opts)` | `UseCustomWebSocketReturn`     | Low-level single-connection hook, usable standalone.              |

### `WebSocketConnection`

Each connection exposes:

- **Messaging:** `sendMessage`, `sendJsonMessage`, `lastMessage`, `lastJsonMessage`, `messageHistory`
- **State:** `readyState`, `connectionStatus`, `isConnected`, `isEnabled`, `debugInfo`
- **Control:** `enable`, `disable`, `forceReconnect`, `disconnect`, `getWebSocket`
- **Params:** `updateQueryParams`, `clearQueryParams`, `currentParams`
- **Identity:** `id`, `url`

## License

[MIT](./LICENSE) © Abdulmalik Adebayo

# react-native-smart-websocket

> Smart WebSocket management for React Native — one manager for every WebSocket in your app, with mobile-optimized reconnection and background handling.

[![npm version](https://img.shields.io/npm/v/react-native-smart-websocket.svg)](https://www.npmjs.com/package/react-native-smart-websocket)
[![license](https://img.shields.io/npm/l/react-native-smart-websocket.svg)](./LICENSE)
[![CI](https://github.com/devProMaleek/react-native-smart-websocket/actions/workflows/ci.yml/badge.svg)](https://github.com/devProMaleek/react-native-smart-websocket/actions/workflows/ci.yml)

Instead of wrapping your app in a separate provider for every socket, you declare **all** of your named connections in a single `WebSocketManagerProvider`. Each connection is isolated, and any component reads the one it needs with `useWebSocket('connection-id')`.

## Features

- **One manager, many connections** — declare every named socket in a single provider, and add or remove connections at runtime without disturbing the others.
- **Isolated re-renders** — each component subscribes to one connection, so a message on one connection only re-renders components reading _that_ connection.
- **Mobile-aware** — pause sockets when the app goes to the background and reconnect on foreground (`pauseOnBackground`, `reconnectOnForeground`).
- **Resilient reconnection** — progressive backoff (1s → 2s → 4s → 8s → 16s), capped at 5 attempts, both configurable. The counter only resets after a connection stays stable for 5s, so flapping connections don't retry forever.
- **Optional heartbeat** — ping/pong keep-alive with customizable messages and timing (`enableHeartbeat`).
- **Dynamic query params** — update or clear a connection's query string at runtime, triggering a reconnect.
- **Connection control** — `enable()` / `disable()`, `forceReconnect()`, `disconnect()`.
- **JSON & string messaging**, last-message tracking, and message history.
- **No runtime dependencies** and **fully typed** — written in TypeScript, ships with type declarations.

## Installation

```sh
npm install react-native-smart-websocket
# or
yarn add react-native-smart-websocket
```

`react` (18+) and `react-native` (0.69+) are peer dependencies. The library has no other dependencies and no native code, so it works in Expo and bare React Native apps with no extra setup or polyfills.

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
import { View, Text, Button } from 'react-native';
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

// Turn the connection on or off
notifications.enable();
notifications.disable();

// Close and reopen right away, with a fresh retry counter
notifications.forceReconnect();

// Merge in query params (reconnects with the new URL when enabled)
notifications.updateQueryParams({ token: 'abc123' });
// Remove every query param, including initialQueryParams
notifications.clearQueryParams();
```

See [How it behaves](#how-it-behaves) for what each method does and when connections reconnect.

## Example: a full app with several connections

This walks through a small app that uses **four** sockets at once — `chat`, `notifications`, `presence`, and `orders` — to show the patterns you'll reuse. New to the library? Read it top to bottom; each step builds on the last.

### 1. Declare every socket in one provider

Define all your connections once. A shared `options` object keeps things DRY, and you can override it per connection.

```tsx
// app-websocket-provider.tsx
import type { ReactNode } from 'react';
import { WebSocketManagerProvider } from 'react-native-smart-websocket';
import type {
  CustomWebSocketOptions,
  WebSocketConfig,
} from 'react-native-smart-websocket';

const WS_BASE = 'wss://api.example.com';

// Defaults applied to every connection.
const sharedOptions: CustomWebSocketOptions = {
  debug: __DEV__, // verbose logs in development only
  enableReconnect: true,
  pauseOnBackground: true,
  reconnectOnForeground: true,
};

const connections: WebSocketConfig[] = [
  // Live chat — connect right away and keep alive with a heartbeat
  // (the server must answer the pings; see Heartbeat below).
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
];

export function AppWebSocketProvider({ children }: { children: ReactNode }) {
  return (
    <WebSocketManagerProvider connections={connections}>
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

The `orders` socket started disabled. Enable it once the user logs in (and disable it on logout). Destructure `enable`/`disable` — they're stable, so the effect runs only when the login state changes. (Setting `initialEnabled: isLoggedIn` instead wouldn't work: it's only read when the connection is created.)

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

`presence` connected with `status=online`. Add the signed-in user's id once it's known: `updateQueryParams` merges it in (giving `status=online&userId=…`), and the socket reconnects with the new URL automatically.

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

`useWebSocketManager()` exposes all connections — handy for a debug/status panel. It re-renders whenever any connection changes, so keep it to screens like this one.

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

## How it behaves

### Sending messages

`sendMessage` and `sendJsonMessage` only send while the socket is open. Anything sent before it connects, or while it's reconnecting, is dropped rather than queued (with `debug` on, you'll see a warning). Check `isConnected` before sending. To send something every time the connection opens, like a subscribe message, use an effect:

```tsx
const { isConnected, sendJsonMessage } = useWebSocket('chat');

useEffect(() => {
  if (isConnected) {
    sendJsonMessage({ type: 'subscribe', room: 'general' });
  }
}, [isConnected, sendJsonMessage]);
```

### Controlling a connection

| Method             | What it does                                                                                                | Undo with                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `enable()`         | Turns the connection on and connects. Also undoes `disconnect()` and resets the retry counter.              | `disable()`                      |
| `disable()`        | Closes the socket and turns the connection off (`'Disabled'`) until you call `enable()`.                    | `enable()`                       |
| `disconnect()`     | Closes the socket and keeps it closed (`'Closed'`), with no automatic reconnects, but leaves it enabled.   | `enable()` or `forceReconnect()` |
| `forceReconnect()` | Closes the socket and opens a new one right away, with a fresh retry counter. Has no effect while disabled. | —                                |

For an on/off switch, like signing in and out, use `enable()` and `disable()`.

### Reconnection

When a connection drops, it reconnects with a growing delay — 1s, 2s, 4s, 8s, then 16s — for up to 5 attempts (see `reconnectAttempts` and `reconnectInterval`). The counter resets once a connection has stayed open for 5 seconds. It doesn't reconnect when:

- the server closes the connection normally (code `1000`), since it meant to end it;
- `enableReconnect` is `false`, or the drop followed an error and `retryOnError` is `false`;
- the connection is disabled, disconnected or paused in the background.

After the last attempt, the connection stays `'Closed'` until you call `forceReconnect()` or `enable()` — for example, from a Retry button:

```tsx
function RetryButton() {
  const { connectionStatus, forceReconnect } = useWebSocket('chat');

  if (connectionStatus !== 'Closed') return null;
  return <Button title="Retry" onPress={forceReconnect} />;
}
```

The button also shows while it waits between automatic attempts; pressing it then just retries sooner.

### Background and foreground

With `pauseOnBackground` (the default), a connection that's open when the app goes to the background is closed, and its status becomes `'Paused (Background)'`. With `reconnectOnForeground` (also the default), it reopens when the app is active again. Connections that weren't open are left alone. If you turn `reconnectOnForeground` off, a paused connection stays paused until you call `enable()` or `forceReconnect()`.

### Heartbeat

With `enableHeartbeat`, the connection sends a ping after 10s without any message, then closes and reconnects after 20s of silence (both configurable with `HeartbeatOptions`). Your server has to answer: any message counts as a sign of life, but a reply is only kept out of `lastMessage` and `messageHistory` when it matches `returnMessage` exactly. If your server doesn't answer pings and is otherwise quiet, leave the heartbeat off, or the connection will drop and reconnect every 20 seconds.

### Changing connections at runtime

`connections` can change while the app runs, for example when it's built from your auth state:

- New ids are added and removed ids are closed, without touching the other connections.
- A new `baseUrl` reconnects with the new URL (if the connection is enabled), and `baseUrl: null` keeps a connection idle until you set one.
- New `options` are picked up without reconnecting.
- `initialEnabled` and `initialQueryParams` are only read when a connection is created. After that, use `enable()`/`disable()` and `updateQueryParams()`.

`useWebSocket(id)` throws if `id` isn't in `connections`, so stop rendering the components that read a connection before you remove it (or `disable()` it instead).

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
| `baseUrl`            | `string \| null`                                  | —       | The WebSocket URL, without dynamic query params. `null` keeps the connection idle. |
| `initialQueryParams` | `Record<string, string \| number \| boolean>`     | `{}`    | Query params added to `baseUrl` when the connection is created. |
| `initialEnabled`     | `boolean`                                          | `false` | Whether to connect as soon as the connection is created. |
| `options`            | `CustomWebSocketOptions`                           | `{}`    | Per-connection behavior (see below).                   |

`initialQueryParams` and `initialEnabled` are only read once; see [Changing connections at runtime](#changing-connections-at-runtime).

### `CustomWebSocketOptions`

| Option                  | Type                                      | Description                                            |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `pauseOnBackground`     | `boolean`                                 | Pause the socket when the app backgrounds. Default `true`. |
| `reconnectOnForeground` | `boolean`                                 | Reconnect when the app returns to the foreground. Default `true`. |
| `enableReconnect`       | `boolean`                                 | Reconnect automatically when the connection drops (see [Reconnection](#reconnection)). Default `true`. |
| `retryOnError`          | `boolean`                                 | Also reconnect when the drop follows an error. Default `true`. |
| `reconnectAttempts`     | `number`                                  | Reconnect attempts allowed before giving up. Default `5`. |
| `reconnectInterval`     | `number \| (attempt: number) => number`   | Delay before each reconnect, in ms: fixed, or a function of the attempt number (1 for the first retry). Default 1s, 2s, 4s, 8s, then 16s. |
| `enableHeartbeat`       | `boolean \| HeartbeatOptions`             | Ping/pong keep-alive; `true` uses the defaults below. Your server must answer (see [Heartbeat](#heartbeat)). Default `false`. |
| `protocols`             | `string \| string[]`                      | WebSocket subprotocols to request.                     |
| `debug`                 | `boolean`                                 | Verbose console logging. Default `false`.              |
| `onOpen`                | `(event: Event) => void`                  | Called when the socket opens.                          |
| `onClose`               | `(event: CloseEvent) => void`             | Called when a socket closes, including ones the library closes itself (for example on a URL change). |
| `onError`               | `(event: Event) => void`                  | Called on a socket error.                              |
| `onMessage`             | `(event: MessageEvent) => void`           | Called on every message, including heartbeat replies.  |

### `HeartbeatOptions`

| Field           | Type     | Default             | Description                                                       |
| --------------- | -------- | ------------------- | ----------------------------------------------------------------- |
| `message`       | `string` | `'{"type":"ping"}'` | Ping sent to the server.                                          |
| `returnMessage` | `string` | `'{"type":"pong"}'` | The server's reply; kept out of `lastMessage` and `messageHistory`. |
| `interval`      | `number` | `10000`             | Ping after this long without receiving anything, in ms.           |
| `timeout`       | `number` | `20000`             | Close and reconnect after this long without receiving anything, in ms. |

### Hooks

| Hook                            | Returns                        | Description                                                       |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------- |
| `useWebSocket(id)`              | `WebSocketConnection`          | Read a named connection from the provider. Throws if `id` isn't configured. |
| `useWebSocketManager()`         | `WebSocketManagerContextType`  | All connections, for debug or status screens. Re-renders whenever any connection changes. |
| `useCustomWebSocket(url, options?, initialEnabled?)` | `UseCustomWebSocketReturn` | A single connection without the provider (see [below](#usecustomwebsocket)). |

### `WebSocketConnection`

Each connection exposes:

- **Messaging:** `sendMessage`, `sendJsonMessage`, `lastMessage`, `lastJsonMessage` (the latest message parsed as JSON, or `null` if it isn't JSON), `messageHistory` (the last 50 messages)
- **State:** `readyState`, `connectionStatus`, `isConnected`, `isEnabled`, `debugInfo` (`url`, `attempts`, `lastError`, `appState`, `isPaused`, `isEnabled`)
- **Control:** `enable`, `disable`, `forceReconnect`, `disconnect` (see [Controlling a connection](#controlling-a-connection)), `getWebSocket`
- **Params:** `updateQueryParams` (merges into the current params), `clearQueryParams` (removes them all), `currentParams`
- **Identity:** `id`, `url`

The methods keep the same identity across renders, so they're safe to use in effect dependencies.

`readyState` uses the exported `ReadyState` enum (`UNINSTANTIATED`, `CONNECTING`, `OPEN`, `CLOSING`, `CLOSED`), and `connectionStatus` is one of `'Disabled'`, `'Paused (Background)'`, `'Uninstantiated'`, `'Connecting'`, `'Connected'`, `'Closing'` or `'Closed'`.

```tsx
import { ReadyState, useWebSocket } from 'react-native-smart-websocket';

const { readyState } = useWebSocket('chat');
const isOpen = readyState === ReadyState.OPEN;
```

### `useCustomWebSocket`

For a socket that belongs to a single screen, you can skip the provider:

```tsx
import { Text } from 'react-native';
import { useCustomWebSocket } from 'react-native-smart-websocket';

type Price = { symbol: string; price: number };

function LivePrice({ symbol }: { symbol: string }) {
  const { lastJsonMessage, isConnected } = useCustomWebSocket<Price>(
    `wss://api.example.com/prices?symbol=${encodeURIComponent(symbol)}`,
    { debug: __DEV__ }
  );

  if (!isConnected) return <Text>Connecting…</Text>;
  return <Text>{lastJsonMessage ? lastJsonMessage.price : '—'}</Text>;
}
```

It takes the same options and returns the same fields as `useWebSocket`, except the query-param helpers (`updateQueryParams`, `clearQueryParams`, `currentParams`) and `id`/`url`: pass a new `url` instead, and it reconnects. Unlike provider connections, it connects right away; pass `false` as the third argument to start disabled. Options can change between renders without reconnecting, and the socket closes when the component unmounts.

## Migrating from 1.x

2.0 replaces `react-use-websocket` with a built-in connection layer. The hooks, the provider and the connection fields are unchanged, so for most apps upgrading is just a version bump.

- **Requirements:** React 18+ and React Native 0.69+. `react-dom` is no longer needed.
- **`share` was removed.** Declare the connection once in `WebSocketManagerProvider` and read it anywhere with `useWebSocket(id)`.
- **react-use-websocket options are no longer accepted.** They were ignored in 1.x. `protocols`, `reconnectAttempts` and `reconnectInterval` are now supported directly.
- **Import `ReadyState` from this package** instead of `react-use-websocket`.
- **`lastJsonMessage` is `null`** for messages that aren't valid JSON (it was `{}`).
- **A server closing with 1001 ("going away") now triggers a reconnect.** Servers send it when they shut down or restart. Only a normal closure (1000) is final.
- **`react-native-url-polyfill` is no longer needed** for query params.

## Development

Issues and pull requests are welcome. To work on the library locally:

```sh
npm install
npm test               # run the test suite
npm run test:coverage  # the tests with coverage thresholds, as CI runs them
npm run lint           # ESLint + Prettier
npm run type-check     # TypeScript, including the tests
npm run build          # bundle to lib/ with type declarations
```

CI runs these checks on every pull request.

## License

[MIT](./LICENSE) © Abdulmalik Adebayo

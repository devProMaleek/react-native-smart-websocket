import { act, render, renderHook, screen } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import {
  useWebSocket,
  useWebSocketManager,
  WebSocketManagerProvider,
  type WebSocketConfig,
} from '../src';
import { flush } from './helpers/act-helpers';
import { FakeWebSocket } from './helpers/fake-websocket';

const chat: WebSocketConfig = {
  id: 'chat',
  baseUrl: 'wss://test.local/chat',
  initialQueryParams: { room: 'general' },
  initialEnabled: true,
};
const notifications: WebSocketConfig = {
  id: 'notifications',
  baseUrl: 'wss://test.local/notifications',
  initialEnabled: true,
};
const orders: WebSocketConfig = {
  id: 'orders',
  baseUrl: 'wss://test.local/orders',
};

const providerWith =
  (connections: WebSocketConfig[]) =>
  ({ children }: { children: ReactNode }) => (
    <WebSocketManagerProvider connections={connections}>
      {children}
    </WebSocketManagerProvider>
  );

const socketFor = (baseUrl: string): FakeWebSocket => {
  const socket = FakeWebSocket.instances.find((s) => s.url.startsWith(baseUrl));
  if (!socket) {
    throw new Error(`No socket was opened for ${baseUrl}`);
  }
  return socket;
};

const silenceConsoleError = () =>
  jest.spyOn(console, 'error').mockImplementation(() => {});

describe('WebSocketManagerProvider', () => {
  it('provides each named connection through useWebSocket on the first render', async () => {
    const { result } = renderHook(
      () => ({
        chat: useWebSocket('chat'),
        orders: useWebSocket('orders'),
      }),
      { wrapper: providerWith([chat, orders]) }
    );
    await flush();

    expect(result.current.chat.id).toBe('chat');
    expect(result.current.chat.url).toBe('wss://test.local/chat?room=general');
    expect(result.current.orders.id).toBe('orders');
  });

  it('only connects the connections that start enabled', async () => {
    const { result } = renderHook(() => useWebSocket('orders'), {
      wrapper: providerWith([chat, orders]),
    });
    await flush();

    expect(FakeWebSocket.instances.map((s) => s.url)).toEqual([
      'wss://test.local/chat?room=general',
    ]);
    expect(result.current.isEnabled).toBe(false);

    act(() => result.current.enable());
    await flush();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(socketFor(orders.baseUrl!).url).toBe('wss://test.local/orders');
  });

  it('only re-renders consumers of the connection that changed', async () => {
    const renders = { chat: 0, notifications: 0 };
    const ChatConsumer = () => {
      useWebSocket('chat');
      renders.chat++;
      return null;
    };
    const NotificationsConsumer = () => {
      useWebSocket('notifications');
      renders.notifications++;
      return null;
    };
    render(
      <WebSocketManagerProvider connections={[chat, notifications]}>
        <ChatConsumer />
        <NotificationsConsumer />
      </WebSocketManagerProvider>
    );
    await flush();
    act(() => {
      socketFor(chat.baseUrl!).open();
      socketFor(notifications.baseUrl!).open();
    });
    const before = { ...renders };

    act(() => socketFor(chat.baseUrl!).receive('hello'));

    expect(renders.chat).toBeGreaterThan(before.chat);
    expect(renders.notifications).toBe(before.notifications);
  });

  it('reconnects with merged query params and can clear them', async () => {
    const { result } = renderHook(() => useWebSocket('chat'), {
      wrapper: providerWith([chat]),
    });
    await flush();

    act(() => result.current.updateQueryParams({ userId: 42 }));
    await flush();

    expect(FakeWebSocket.latest().url).toBe(
      'wss://test.local/chat?room=general&userId=42'
    );
    expect(result.current.currentParams).toEqual({
      room: 'general',
      userId: 42,
    });

    act(() => result.current.clearQueryParams());
    await flush();

    expect(FakeWebSocket.latest().url).toBe('wss://test.local/chat');
    expect(result.current.currentParams).toEqual({});
  });

  it('replaces the socket on a query param change without using up reconnect attempts', async () => {
    const { result } = renderHook(() => useWebSocket('chat'), {
      wrapper: providerWith([chat]),
    });
    await flush();
    const original = FakeWebSocket.latest();
    act(() => original.open());

    for (let page = 1; page <= 3; page++) {
      act(() => result.current.updateQueryParams({ page }));
      await flush();
    }

    expect(original.closeCalls).toEqual([
      { code: 1000, reason: 'URL changed' },
    ]);
    expect(FakeWebSocket.instances).toHaveLength(4);
    expect(result.current.debugInfo.attempts).toBe(0);
  });

  it('keeps a single live socket per connection under StrictMode', async () => {
    render(
      <React.StrictMode>
        <WebSocketManagerProvider connections={[chat, notifications]}>
          <span />
        </WebSocketManagerProvider>
      </React.StrictMode>
    );
    await flush();

    const live = FakeWebSocket.instances.filter(
      (socket) => socket.closeCalls.length === 0
    );
    expect(live.map((socket) => socket.url).sort()).toEqual([
      'wss://test.local/chat?room=general',
      'wss://test.local/notifications',
    ]);
  });

  describe('dynamic connection lists', () => {
    const Ids = () => {
      const { connections } = useWebSocketManager();
      return (
        <span data-testid="ids">
          {[...connections.keys()].sort().join(',')}
        </span>
      );
    };

    it('adds a connection without reconnecting the existing ones', async () => {
      const { rerender } = render(
        <WebSocketManagerProvider connections={[chat]}>
          <Ids />
        </WebSocketManagerProvider>
      );
      await flush();
      const chatSocket = socketFor(chat.baseUrl!);
      act(() => chatSocket.open());

      rerender(
        <WebSocketManagerProvider connections={[chat, notifications]}>
          <Ids />
        </WebSocketManagerProvider>
      );
      await flush();

      expect(screen.getByTestId('ids').textContent).toBe('chat,notifications');
      expect(socketFor(notifications.baseUrl!)).toBeDefined();
      expect(chatSocket.closeCalls).toHaveLength(0);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('removes a connection without reconnecting the others', async () => {
      const { rerender } = render(
        <WebSocketManagerProvider connections={[chat, notifications]}>
          <Ids />
        </WebSocketManagerProvider>
      );
      await flush();
      const chatSocket = socketFor(chat.baseUrl!);
      const notificationsSocket = socketFor(notifications.baseUrl!);

      // Remove the *first* connection, which used to remount the rest.
      rerender(
        <WebSocketManagerProvider connections={[notifications]}>
          <Ids />
        </WebSocketManagerProvider>
      );
      await flush();

      expect(screen.getByTestId('ids').textContent).toBe('notifications');
      expect(chatSocket.closeCalls).toEqual([
        { code: 1000, reason: 'Connection stopped' },
      ]);
      expect(notificationsSocket.closeCalls).toHaveLength(0);
      expect(FakeWebSocket.forUrl(notifications.baseUrl!)).toHaveLength(1);
    });
  });

  describe('useWebSocketManager', () => {
    it('re-renders as connection state changes', async () => {
      const Statuses = () => {
        const { connections } = useWebSocketManager();
        return (
          <span data-testid="statuses">
            {[...connections.values()]
              .map((c) => `${c.id}:${c.connectionStatus}`)
              .sort()
              .join('|')}
          </span>
        );
      };
      render(
        <WebSocketManagerProvider connections={[chat, orders]}>
          <Statuses />
        </WebSocketManagerProvider>
      );
      await flush();

      expect(screen.getByTestId('statuses').textContent).toBe(
        'chat:Connecting|orders:Disabled'
      );

      act(() => socketFor(chat.baseUrl!).open());

      expect(screen.getByTestId('statuses').textContent).toBe(
        'chat:Connected|orders:Disabled'
      );
    });

    it('looks up connections by id', async () => {
      const { result } = renderHook(() => useWebSocketManager(), {
        wrapper: providerWith([chat, orders]),
      });
      await flush();

      expect(result.current.getConnection('chat')?.id).toBe('chat');
      expect(result.current.getConnection('missing')).toBeUndefined();
    });
  });

  describe('misuse', () => {
    it('throws a helpful error for an unknown connection id', () => {
      silenceConsoleError();

      expect(() =>
        renderHook(() => useWebSocket('missing'), {
          wrapper: providerWith([chat]),
        })
      ).toThrow("WebSocket connection 'missing' not found");
    });

    it('throws when useWebSocket is used outside the provider', () => {
      silenceConsoleError();

      expect(() => renderHook(() => useWebSocket('chat'))).toThrow(
        "WebSocket connection 'chat' not found"
      );
    });

    it('throws when useWebSocketManager is used outside the provider', () => {
      silenceConsoleError();

      expect(() => renderHook(() => useWebSocketManager())).toThrow(
        'useWebSocketManager must be used within a WebSocketManagerProvider'
      );
    });

    it('warns about duplicate connection ids', async () => {
      silenceConsoleError();
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      render(
        <WebSocketManagerProvider connections={[chat, chat]}>
          <span />
        </WebSocketManagerProvider>
      );
      await flush();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Duplicate connection ids detected')
      );
    });
  });
});

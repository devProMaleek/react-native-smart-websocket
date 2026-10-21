import { act, renderHook } from '@testing-library/react';
import { ReadyState } from 'react-use-websocket';
import { useCustomWebSocket } from '../src/hooks/use-custom-web-socket';
import type { CustomWebSocketOptions } from '../src/types';
import { advance, flush } from './helpers/act-helpers';
import { FakeWebSocket } from './helpers/fake-websocket';
import {
  emitAppStateChange,
  getAppStateListenerCount,
} from './mocks/react-native';

const SOCKET_URL = 'wss://test.local/socket';

interface HookProps {
  url: string | null;
  options: CustomWebSocketOptions;
  initialEnabled: boolean;
}

const renderSocket = async (props: Partial<HookProps> = {}) => {
  const initialProps: HookProps = {
    url: SOCKET_URL,
    options: {},
    initialEnabled: true,
    ...props,
  };
  const view = renderHook(
    ({ url, options, initialEnabled }: HookProps) =>
      useCustomWebSocket(url, options, initialEnabled),
    { initialProps }
  );
  await flush();
  return view;
};

/** Opens the socket, keeps it up for `uptimeMs`, then drops it (1006). */
const dropAfter = async (socket: FakeWebSocket, uptimeMs: number) => {
  act(() => socket.open());
  await advance(uptimeMs);
  act(() => socket.serverClose(1006));
  await advance(16_000);
};

/** Fails the connection attempt outright (error + close 1006). */
const failAttempt = async (socket: FakeWebSocket) => {
  act(() => socket.fail());
  await advance(16_000);
};

/** Repeats `drop` on the newest socket until the hook stops reconnecting. */
const dropUntilGivingUp = async (
  drop: (socket: FakeWebSocket) => Promise<void>
) => {
  for (let guard = 0; guard < 30; guard++) {
    const before = FakeWebSocket.instances.length;
    await drop(FakeWebSocket.latest());
    if (FakeWebSocket.instances.length === before) {
      return;
    }
  }
  throw new Error('The hook kept reconnecting more than 30 times');
};

beforeEach(() => {
  jest.useFakeTimers();
});

describe('useCustomWebSocket', () => {
  describe('connection lifecycle', () => {
    it('connects to the URL when enabled', async () => {
      const { result } = await renderSocket();

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(FakeWebSocket.latest().url).toBe(SOCKET_URL);
      expect(result.current.readyState).toBe(ReadyState.CONNECTING);
      expect(result.current.connectionStatus).toBe('Connecting');

      act(() => FakeWebSocket.latest().open());

      expect(result.current.readyState).toBe(ReadyState.OPEN);
      expect(result.current.isConnected).toBe(true);
      expect(result.current.connectionStatus).toBe('Connected');
    });

    it('does not connect without a URL', async () => {
      const { result } = await renderSocket({ url: null });

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(result.current.readyState).toBe(ReadyState.UNINSTANTIATED);
      expect(result.current.connectionStatus).toBe('Uninstantiated');
    });

    it('waits for enable() when created disabled', async () => {
      const { result } = await renderSocket({ initialEnabled: false });

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(result.current.isEnabled).toBe(false);
      expect(result.current.connectionStatus).toBe('Disabled');

      act(() => result.current.enable());
      await flush();

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(result.current.isEnabled).toBe(true);
    });

    it('disable() closes the socket and keeps it closed', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => result.current.disable());
      await flush();

      expect(socket.closeCalls[0]).toEqual({
        code: 1000,
        reason: 'Connection disabled',
      });
      expect(result.current.connectionStatus).toBe('Disabled');
      expect(result.current.isConnected).toBe(false);

      await advance(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('disconnect() closes the socket without reconnecting', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => result.current.disconnect());
      await flush();

      expect(socket.closeCalls[0]).toEqual({
        code: 1000,
        reason: 'Manual disconnect',
      });
      await advance(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('forceReconnect() reconnects after a manual disconnect', async () => {
      const { result } = await renderSocket();
      act(() => FakeWebSocket.latest().open());
      act(() => result.current.disconnect());
      await flush();

      act(() => result.current.forceReconnect());
      await flush();

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('reconnects to the new URL when the URL changes', async () => {
      const { rerender } = await renderSocket();
      const original = FakeWebSocket.latest();
      act(() => original.open());

      rerender({
        url: 'wss://test.local/other',
        options: {},
        initialEnabled: true,
      });
      await flush();

      expect(original.closeCalls.length).toBeGreaterThan(0);
      expect(FakeWebSocket.latest().url).toBe('wss://test.local/other');
    });

    it('reports a closed connection that will not reconnect as Closed', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => socket.serverClose(1000));

      expect(result.current.connectionStatus).toBe('Closed');
    });
  });

  describe('messaging', () => {
    it('exposes received messages as lastMessage, lastJsonMessage and messageHistory', async () => {
      const onMessage = jest.fn();
      const { result } = await renderSocket({ options: { onMessage } });
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => socket.receive('{"type":"greeting","text":"hi"}'));

      expect(result.current.lastMessage?.data).toBe(
        '{"type":"greeting","text":"hi"}'
      );
      expect(result.current.lastJsonMessage).toEqual({
        type: 'greeting',
        text: 'hi',
      });
      expect(result.current.messageHistory.map((m) => m.data)).toEqual([
        '{"type":"greeting","text":"hi"}',
      ]);
      expect(onMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps only the 50 most recent messages in messageHistory', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => {
        for (let i = 1; i <= 60; i++) {
          socket.receive(`message ${i}`);
        }
      });

      const history = result.current.messageHistory;
      expect(history).toHaveLength(50);
      expect(history[0]?.data).toBe('message 11');
      expect(history[49]?.data).toBe('message 60');
    });

    it('sends text and JSON while connected', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => {
        result.current.sendMessage('hello');
        result.current.sendJsonMessage({ type: 'join', room: 'general' });
      });

      expect(socket.sent).toEqual([
        'hello',
        '{"type":"join","room":"general"}',
      ]);
    });

    it('drops messages sent while not connected instead of queueing them', async () => {
      const { result } = await renderSocket();

      act(() => result.current.sendMessage('too early'));
      act(() => FakeWebSocket.latest().open());

      expect(FakeWebSocket.latest().sent).toEqual([]);
    });

    it('warns about dropped messages when debug is on', async () => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const { result } = await renderSocket({ options: { debug: true } });

      act(() => result.current.sendMessage('too early'));

      expect(warn).toHaveBeenCalledWith(
        '❌ Cannot send message - WebSocket is Connecting'
      );
    });
  });

  describe('reconnection', () => {
    it('reconnects after the server drops the connection', async () => {
      await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => socket.serverClose(1006));
      await advance(999);
      expect(FakeWebSocket.instances).toHaveLength(1);

      await advance(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('backs off 1s, 2s, 4s between attempts while the server is unreachable', async () => {
      await renderSocket();

      for (const delay of [1_000, 2_000, 4_000]) {
        const attempts = FakeWebSocket.instances.length;
        act(() => FakeWebSocket.latest().fail());

        await advance(delay - 1);
        expect(FakeWebSocket.instances).toHaveLength(attempts);
        await advance(1);
        expect(FakeWebSocket.instances).toHaveLength(attempts + 1);
      }
    });

    it.each([1000, 1001])(
      'does not reconnect after an intentional close (%i)',
      async (code) => {
        await renderSocket();
        const socket = FakeWebSocket.latest();
        act(() => socket.open());

        act(() => socket.serverClose(code));
        await advance(60_000);

        expect(FakeWebSocket.instances).toHaveLength(1);
      }
    );

    it('gives up after 5 attempts when the server stays unreachable', async () => {
      await renderSocket();

      await dropUntilGivingUp(failAttempt);

      // The initial connection plus 5 reconnect attempts.
      expect(FakeWebSocket.instances).toHaveLength(6);
    });

    it('gives up after 5 attempts when the connection keeps dropping quickly', async () => {
      await renderSocket();

      await dropUntilGivingUp((socket) => dropAfter(socket, 1_000));

      // The initial connection plus 5 reconnect attempts.
      expect(FakeWebSocket.instances).toHaveLength(6);
    });

    it('allows 5 fresh attempts once a connection stays up for 5 seconds', async () => {
      await renderSocket();
      for (let i = 0; i < 4; i++) {
        await dropAfter(FakeWebSocket.latest(), 1_000);
      }
      expect(FakeWebSocket.instances).toHaveLength(5);

      // Staying up past the 5s stability window resets the attempt counter, so
      // 5 more reconnects are allowed (the drop after it is the first of them).
      await dropAfter(FakeWebSocket.latest(), 5_000);
      await dropUntilGivingUp((socket) => dropAfter(socket, 1_000));

      expect(FakeWebSocket.instances).toHaveLength(10);
    });

    it('never reconnects when enableReconnect is false', async () => {
      await renderSocket({ options: { enableReconnect: false } });
      act(() => FakeWebSocket.latest().open());

      act(() => FakeWebSocket.latest().fail());
      await advance(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('does not reconnect after a connection error when retryOnError is false', async () => {
      await renderSocket({ options: { retryOnError: false } });
      act(() => FakeWebSocket.latest().open());

      act(() => FakeWebSocket.latest().fail());
      await advance(60_000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('still reconnects after a server drop when retryOnError is false', async () => {
      await renderSocket({ options: { retryOnError: false } });
      act(() => FakeWebSocket.latest().open());

      act(() => FakeWebSocket.latest().serverClose(1006));
      await advance(1_000);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });
  });

  describe('app state', () => {
    it('closes the socket in the background and reopens it on return', async () => {
      const { result } = await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => emitAppStateChange('background'));
      await flush();

      expect(socket.closeCalls[0]).toEqual({
        code: 1000,
        reason: 'App backgrounded',
      });
      expect(result.current.connectionStatus).toBe('Paused (Background)');
      expect(result.current.isConnected).toBe(false);
      await advance(60_000);
      expect(FakeWebSocket.instances).toHaveLength(1);

      act(() => emitAppStateChange('active'));
      await flush();
      expect(FakeWebSocket.instances).toHaveLength(2);

      act(() => FakeWebSocket.latest().open());
      expect(result.current.connectionStatus).toBe('Connected');
    });

    it('stays connected in the background when pauseOnBackground is false', async () => {
      const { result } = await renderSocket({
        options: { pauseOnBackground: false },
      });
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => emitAppStateChange('background'));
      await flush();

      expect(socket.closeCalls).toHaveLength(0);
      expect(result.current.isConnected).toBe(true);
    });

    it('stays paused on return when reconnectOnForeground is false', async () => {
      const { result } = await renderSocket({
        options: { reconnectOnForeground: false },
      });
      act(() => FakeWebSocket.latest().open());

      act(() => emitAppStateChange('background'));
      await flush();
      act(() => emitAppStateChange('active'));
      await flush();

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(result.current.connectionStatus).toBe('Paused (Background)');
    });

    it('does not connect on return if it was not connected before', async () => {
      const { result } = await renderSocket({ initialEnabled: false });

      act(() => emitAppStateChange('background'));
      act(() => emitAppStateChange('active'));
      await flush();

      expect(FakeWebSocket.instances).toHaveLength(0);
      expect(result.current.connectionStatus).toBe('Disabled');
    });

    it('removes its AppState listener on unmount', async () => {
      const { unmount } = await renderSocket();
      expect(getAppStateListenerCount()).toBe(1);

      unmount();

      expect(getAppStateListenerCount()).toBe(0);
    });
  });

  describe('heartbeat', () => {
    it('sends a ping every 10 seconds while connected', async () => {
      await renderSocket({ options: { enableHeartbeat: true } });
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      await advance(9_999);
      expect(socket.sent).toEqual([]);
      await advance(1);

      expect(socket.sent).toEqual(['{"type":"ping"}']);
    });

    it('keeps pong replies out of lastMessage', async () => {
      const { result } = await renderSocket({
        options: { enableHeartbeat: true },
      });
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      act(() => socket.receive('{"type":"pong"}'));

      expect(result.current.lastMessage).toBeNull();
    });

    it('reconnects when the heartbeat times out', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      await renderSocket({ options: { enableHeartbeat: true } });
      act(() => FakeWebSocket.latest().open());

      // No pong for 20s: the heartbeat closes the socket, then we reconnect.
      await advance(21_000);

      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('does not send pings when the heartbeat is disabled', async () => {
      await renderSocket();
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      await advance(60_000);

      expect(socket.sent).toEqual([]);
    });
  });

  describe('callbacks and options', () => {
    it('calls onOpen, onError and onClose', async () => {
      const onOpen = jest.fn();
      const onError = jest.fn();
      const onClose = jest.fn();
      await renderSocket({ options: { onOpen, onError, onClose } });
      const socket = FakeWebSocket.latest();

      act(() => socket.open());
      expect(onOpen).toHaveBeenCalledTimes(1);

      act(() => socket.fail());
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledWith(
        expect.objectContaining({ code: 1006 })
      );
    });

    it('uses the latest callbacks without reconnecting', async () => {
      const first = jest.fn();
      const second = jest.fn();
      const { rerender } = await renderSocket({
        options: { onMessage: first },
      });
      const socket = FakeWebSocket.latest();
      act(() => socket.open());

      rerender({
        url: SOCKET_URL,
        options: { onMessage: second },
        initialEnabled: true,
      });
      await flush();
      act(() => socket.receive('hello'));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('records the last error in debugInfo', async () => {
      const { result } = await renderSocket();

      act(() => FakeWebSocket.latest().fail());

      expect(result.current.debugInfo.lastError).toBe('WebSocket error: error');
    });

    it('shares one socket between hooks when share is true', async () => {
      await renderSocket({ options: { share: true } });
      await renderSocket({ options: { share: true } });

      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });
});

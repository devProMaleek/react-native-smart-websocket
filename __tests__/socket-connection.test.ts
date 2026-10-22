import { ReadyState } from '../src';
import {
  SocketConnection,
  type SocketConnectionSetup,
} from '../src/core/socket-connection';
import { FakeWebSocket } from './helpers/fake-websocket';
import { AppState } from './mocks/react-native';

const create = (setup: Partial<SocketConnectionSetup> = {}) =>
  new SocketConnection({
    baseUrl: 'wss://test.local/socket',
    appState: AppState,
    ...setup,
  });

describe('SocketConnection', () => {
  it('does not open a socket until started', () => {
    const connection = create();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(connection.getSnapshot().readyState).toBe(ReadyState.UNINSTANTIATED);

    connection.start();

    expect(FakeWebSocket.instances).toHaveLength(1);
    connection.stop();
  });

  it('returns the same snapshot until something changes', () => {
    const connection = create();
    const initial = connection.getSnapshot();

    expect(connection.getSnapshot()).toBe(initial);

    connection.start();

    expect(connection.getSnapshot()).not.toBe(initial);
    expect(connection.getSnapshot().readyState).toBe(ReadyState.CONNECTING);
    connection.stop();
  });

  it('only notifies subscribers about real changes', () => {
    const connection = create();
    const listener = jest.fn();
    connection.subscribe(listener);

    connection.enable(); // already enabled
    expect(listener).not.toHaveBeenCalled();

    connection.disable();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps action references stable across snapshots', () => {
    const connection = create();
    const before = connection.getSnapshot();

    connection.start();
    const after = connection.getSnapshot();

    expect(after.sendMessage).toBe(before.sendMessage);
    expect(after.enable).toBe(before.enable);
    expect(after.updateQueryParams).toBe(before.updateQueryParams);
    connection.stop();
  });

  it('can be stopped and started again', () => {
    const connection = create();

    connection.start();
    connection.start();
    expect(FakeWebSocket.instances).toHaveLength(1);

    connection.stop();
    connection.stop();
    expect(FakeWebSocket.latest().closeCalls).toEqual([
      { code: 1000, reason: 'Connection stopped' },
    ]);

    connection.start();
    expect(FakeWebSocket.instances).toHaveLength(2);
    connection.stop();
  });

  it('ignores events from a socket it has replaced', () => {
    const connection = create();
    connection.start();
    const replaced = FakeWebSocket.latest();

    connection.forceReconnect();
    replaced.receive('late message');

    expect(connection.getSnapshot().lastMessage).toBeNull();
    connection.stop();
  });
});

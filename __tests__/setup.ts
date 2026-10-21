import { cleanup } from '@testing-library/react';
import { FakeWebSocket } from './helpers/fake-websocket';
import { resetAppState } from './mocks/react-native';

const realWebSocket = globalThis.WebSocket;

const setGlobalWebSocket = (value: unknown): void => {
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value,
  });
};

beforeEach(() => {
  FakeWebSocket.reset();
  setGlobalWebSocket(FakeWebSocket);
});

afterEach(() => {
  // Unmount while fake timers (if any) are still installed, so effect
  // cleanups clear the timers they actually scheduled.
  cleanup();
  jest.useRealTimers();
  setGlobalWebSocket(realWebSocket);
  resetAppState();
});

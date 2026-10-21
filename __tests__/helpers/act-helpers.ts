import { act } from '@testing-library/react';

/**
 * Lets pending promise work settle (react-use-websocket resolves the URL
 * asynchronously before opening a socket) and flushes the React updates.
 */
export const flush = (): Promise<void> => act(async () => {});

/** Advances Jest's fake timers and flushes the React updates they trigger. */
export const advance = (ms: number): Promise<void> =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

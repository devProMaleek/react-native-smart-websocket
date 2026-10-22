import { act } from '@testing-library/react';

/**
 * Lets pending promise work settle (such as a FakeWebSocket's asynchronous
 * close event) and flushes the React updates it triggers.
 */
export const flush = (): Promise<void> => act(async () => {});

/** Advances Jest's fake timers and flushes the React updates they trigger. */
export const advance = (ms: number): Promise<void> =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

import type { AppStateStatus } from 'react-native';

type AppStateListener = (state: AppStateStatus) => void;

const listeners = new Set<AppStateListener>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener: (_type: 'change', listener: AppStateListener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  },
};

// --- Test controls ---

/** Moves the app to a new state and notifies every subscribed listener. */
export const emitAppStateChange = (state: AppStateStatus): void => {
  AppState.currentState = state;
  listeners.forEach((listener) => listener(state));
};

export const getAppStateListenerCount = (): number => listeners.size;

export const resetAppState = (): void => {
  listeners.clear();
  AppState.currentState = 'active';
};

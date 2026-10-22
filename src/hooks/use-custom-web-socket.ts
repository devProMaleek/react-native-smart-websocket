import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { SocketConnection } from '../core/socket-connection';
import type {
  CustomWebSocketOptions,
  UseCustomWebSocketReturn,
} from '../types';

export const useCustomWebSocket = <
  TJsonMessage = unknown,
  TMessageData = string,
>(
  url: string | null,
  options: CustomWebSocketOptions = {},
  initialEnabled: boolean = true
): UseCustomWebSocketReturn<TJsonMessage, TMessageData> => {
  const [connection] = useState(
    () =>
      new SocketConnection({
        baseUrl: url,
        enabled: initialEnabled,
        options,
        appState: AppState,
      })
  );

  // Use the latest callbacks and settings without reconnecting.
  useEffect(() => {
    connection.setOptions(options);
  }, [connection, options]);

  useEffect(() => {
    connection.setBaseUrl(url);
  }, [connection, url]);

  useEffect(() => {
    connection.start();
    return () => connection.stop();
  }, [connection]);

  const snapshot = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot
  );

  // The connection stores messages as `unknown`; narrow to the caller's types.
  return snapshot as unknown as UseCustomWebSocketReturn<
    TJsonMessage,
    TMessageData
  >;
};

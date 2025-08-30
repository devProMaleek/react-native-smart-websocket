import { useCustomWebSocket } from "../hooks/use-custom-web-socket";
import {
  useCallback,
  useMemo,
  useState,
} from 'react';

// Helper function to build URL with query parameters
export const buildUrlWithParams = (
  baseUrl: string,
  params: Record<string, string | number | boolean>,
): string => {
  if (!baseUrl || Object.keys(params).length === 0) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

// Custom hook for individual WebSocket connection with query param management and connection control
export const useWebSocketWithParams = (
  baseUrl: string | null,
  initialParams: Record<string, string | number | boolean> = {},
  options: Parameters<typeof useCustomWebSocket>[1] = {},
  initialEnabled: boolean = false, // Default to disabled to prevent auto-connect
) => {
  const [queryParams, setQueryParams] = useState(initialParams);

  // Build the full URL with current query parameters
  const fullUrl = useMemo(() => {
    if (!baseUrl) return null;
    return buildUrlWithParams(baseUrl, queryParams);
  }, [baseUrl, queryParams]);

  // Use the custom WebSocket hook with connection control
  const webSocketData = useCustomWebSocket(fullUrl, options, initialEnabled);

  // Function to update query parameters (will trigger reconnection if enabled)
  const updateQueryParams = useCallback(
    (newParams: Record<string, string | number | boolean>) => {
      setQueryParams((prev) => ({ ...prev, ...newParams }));
    },
    [],
  );

  // Function to clear all query parameters
  const clearQueryParams = useCallback(() => {
    setQueryParams({});
  }, []);

  return {
    ...webSocketData,
    updateQueryParams,
    clearQueryParams,
    currentParams: queryParams,
  };
};
import type { QueryParams } from '../types';

// Helper function to build URL with query parameters.
// Falls back to manual query-string assembly when the runtime's `URL` /
// `URLSearchParams` implementation is missing or incomplete (common on older
// React Native versions without `react-native-url-polyfill`).
export const buildUrlWithParams = (
  baseUrl: string,
  params: QueryParams
): string => {
  if (!baseUrl || Object.keys(params).length === 0) {
    return baseUrl;
  }

  try {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  } catch {
    const queryString = Object.entries(params)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      )
      .join('&');

    if (!queryString) {
      return baseUrl;
    }

    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${queryString}`;
  }
};

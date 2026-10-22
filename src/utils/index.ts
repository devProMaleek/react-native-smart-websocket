import type { QueryParams } from '../types';

const decodeKey = (pair: string): string => {
  const key = pair.split('=', 1)[0].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(key);
  } catch {
    // A malformed escape sequence: compare the key as written.
    return key;
  }
};

// Adds query params to a URL, replacing any it already has with the same key.
// Built by hand rather than with the global `URL`: React Native's built-in one
// adds a trailing slash to the path and repeats the existing query, without
// throwing, so it can't be detected and worked around.
export const buildUrlWithParams = (
  baseUrl: string,
  params: QueryParams
): string => {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== null && value !== undefined
  );
  if (!baseUrl || entries.length === 0) {
    return baseUrl;
  }

  const hashStart = baseUrl.indexOf('#');
  const hash = hashStart === -1 ? '' : baseUrl.slice(hashStart);
  const beforeHash = hashStart === -1 ? baseUrl : baseUrl.slice(0, hashStart);
  const queryStart = beforeHash.indexOf('?');
  const path = queryStart === -1 ? beforeHash : beforeHash.slice(0, queryStart);
  const query = queryStart === -1 ? '' : beforeHash.slice(queryStart + 1);

  const keys = new Set(entries.map(([key]) => key));
  const kept = query
    .split('&')
    .filter((pair) => pair !== '' && !keys.has(decodeKey(pair)));
  const added = entries.map(
    ([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
  );
  return `${path}?${[...kept, ...added].join('&')}${hash}`;
};

// Helper function to build URL with query parameters
const buildUrlWithParams = (
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
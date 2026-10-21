import { buildUrlWithParams } from '../src/utils';

describe('buildUrlWithParams', () => {
  it('returns the base URL unchanged when there are no params', () => {
    expect(buildUrlWithParams('wss://api.example.com/chat', {})).toBe(
      'wss://api.example.com/chat'
    );
  });

  it('returns an empty base URL unchanged', () => {
    expect(buildUrlWithParams('', { room: 'general' })).toBe('');
  });

  it('appends string, number and boolean params', () => {
    expect(
      buildUrlWithParams('wss://api.example.com/chat', {
        room: 'general',
        page: 2,
        live: true,
      })
    ).toBe('wss://api.example.com/chat?room=general&page=2&live=true');
  });

  it('keeps existing query params and overrides keys that are passed again', () => {
    expect(
      buildUrlWithParams('wss://api.example.com/chat?token=abc&room=old', {
        room: 'new',
      })
    ).toBe('wss://api.example.com/chat?token=abc&room=new');
  });

  it('encodes special characters', () => {
    const url = buildUrlWithParams('wss://api.example.com/search', {
      q: 'a b&c=d',
    });

    expect(new URL(url).searchParams.get('q')).toBe('a b&c=d');
  });

  it('skips null and undefined values', () => {
    const params = {
      room: 'general',
      token: undefined,
      user: null,
    } as unknown as Record<string, string>;

    expect(buildUrlWithParams('wss://api.example.com/chat', params)).toBe(
      'wss://api.example.com/chat?room=general'
    );
  });

  describe('when the URL API cannot be used', () => {
    it('assembles the query string manually for URLs the URL API rejects', () => {
      expect(
        buildUrlWithParams('/relative/socket', { room: 'general', q: 'a b' })
      ).toBe('/relative/socket?room=general&q=a%20b');
    });

    it('falls back when the runtime has no working URL implementation', () => {
      jest.spyOn(globalThis, 'URL').mockImplementation(() => {
        throw new TypeError('URL is not supported');
      });

      expect(
        buildUrlWithParams('wss://api.example.com/chat', { room: 'general' })
      ).toBe('wss://api.example.com/chat?room=general');
    });

    it('appends with & when the base URL already has a query string', () => {
      expect(buildUrlWithParams('/socket?token=abc', { room: 'general' })).toBe(
        '/socket?token=abc&room=general'
      );
    });

    it('returns the base URL when every param value is empty', () => {
      const params = { token: undefined } as unknown as Record<string, string>;

      expect(buildUrlWithParams('/socket', params)).toBe('/socket');
    });
  });
});

/**
 * urlParser.js — M3U Link Parser
 * Extracts username, password, and base domain from M3U streaming subscription URLs.
 */

const LOG = (...a) => console.log('[Z2U][urlParser]', ...a);

/**
 * Parse an M3U URL and extract credential fields.
 *
 * @param {string} m3uUrl - Full M3U URL, e.g. "http://skyline-mm.com/get.php?username=Z5189504068&password=czd2AHDxZ&type=m3u&output=ts"
 * @returns {{ username: string, password: string, baseDomain: string, rawUrl: string } | null}
 */
export function parseM3uUrl(m3uUrl) {
  if (!m3uUrl || typeof m3uUrl !== 'string') {
    LOG('parseM3uUrl: invalid input', m3uUrl);
    return null;
  }

  const trimmed = m3uUrl.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);

    const username = url.searchParams.get('username') || '';
    const password = url.searchParams.get('password') || '';

    if (!username || !password) {
      LOG('parseM3uUrl: missing username or password in URL params');
      return null;
    }

    // Extract base domain: protocol + host only (no path, no query string)
    const baseDomain = `${url.protocol}//${url.host}`;

    LOG(`parseM3uUrl: ✅ username="${username}" domain="${baseDomain}"`);

    return {
      username,
      password,
      baseDomain,
      rawUrl: trimmed,
    };
  } catch (e) {
    LOG(`parseM3uUrl: failed to parse URL "${trimmed.slice(0, 80)}" — ${e.message}`);
    return null;
  }
}

/**
 * Validate that a string looks like a plausible M3U streaming URL.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isM3uUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      (trimmed.includes('username=') || trimmed.includes('get.php'))
    );
  } catch {
    return false;
  }
}

/**
 * Extract the first M3U URL found in a block of text (e.g. Lfollowers API response).
 *
 * @param {string} text - Raw text that may contain an M3U URL
 * @returns {string | null} - The extracted URL or null
 */
export function extractM3uFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Match common M3U URL patterns: starts with http, contains get.php or m3u, has username param
  const patterns = [
    /https?:\/\/[^\s'"<>]+get\.php\?[^'"<>\s]+/gi,
    /https?:\/\/[^\s'"<>]+\.m3u[8]?[^\s'"<>]*/gi,
    /https?:\/\/[^\s'"<>]+\/get\.php\?[^'"<>\s]+username=[^\s'"<>]+/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      // Return the first valid-looking M3U URL
      const candidate = matches[0].split(/\s/)[0]; // strip any trailing text
      if (isM3uUrl(candidate)) {
        LOG(`extractM3uFromText: found "${candidate.slice(0, 80)}"`);
        return candidate;
      }
    }
  }

  LOG('extractM3uFromText: no M3U URL found in text');
  return null;
}
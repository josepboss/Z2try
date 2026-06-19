/**
 * domainConfig.js — Server Domain Mapping Configuration
 *
 * Maps IPTV server base domains to their alternative/backup domains.
 * Used by the chat delivery pipeline to include fallback domains in the
 * formatted message sent to buyers.
 *
 * HOW TO ADD / UPDATE SERVERS:
 *   1. Add a new entry: "http://your-server.com": ["http://alt1.com", "http://alt2.com"]
 *   2. Remove an entry by deleting its line
 *   3. Alternative domains are optional — if a server has none, just use []
 *
 * The extension reads this config at startup and on demand via getAlternativeDomains().
 */

/** @type {Record<string, string[]>} */
const serverDomainConfig = {
  // ── Skyline servers ────────────────────────────────────────────────────────
  "http://skyline-mm.com": [
    "http://example1.com",
    "http://example2.com",
  ],

  // ── TRX DNS Cloud servers ──────────────────────────────────────────────────
  "http://line.trxdnscloud.ru": [
    "http://vpn.trxdnscloud.ru",
    "http://tv.trexiptv.com",
  ],

  // ── Add your servers below ─────────────────────────────────────────────────
  // Template:
  // "http://your-server-domain.com": [
  //   "http://alt-domain-1.com",
  //   "http://alt-domain-2.com",
  // ],
};

const LOG = (...a) => console.log('[Z2U][domainConfig]', ...a);

/**
 * Get the list of alternative domains for a given base domain.
 *
 * @param {string} baseDomain - The base domain, e.g. "http://skyline-mm.com"
 * @returns {string[]} - Array of alternative domains, or [] if not configured
 */
export function getAlternativeDomains(baseDomain) {
  if (!baseDomain || typeof baseDomain !== 'string') {
    return [];
  }

  const normalized = baseDomain.trim().toLowerCase();

  // Try exact match first
  if (serverDomainConfig[normalized]) {
    LOG(`getAlternativeDomains: exact match for "${normalized}" → ${JSON.stringify(serverDomainConfig[normalized])}`);
    return serverDomainConfig[normalized];
  }

  // Try case-insensitive match
  const lowerKeys = Object.keys(serverDomainConfig).map(k => k.toLowerCase());
  const idx = lowerKeys.indexOf(normalized);
  if (idx !== -1) {
    const matchedKey = Object.keys(serverDomainConfig)[idx];
    LOG(`getAlternativeDomains: case-insensitive match for "${normalized}" → ${JSON.stringify(serverDomainConfig[matchedKey])}`);
    return serverDomainConfig[matchedKey];
  }

  // Try without trailing slash
  const noSlash = normalized.replace(/\/$/, '');
  if (serverDomainConfig[noSlash]) {
    LOG(`getAlternativeDomains: no-slash match for "${noSlash}" → ${JSON.stringify(serverDomainConfig[noSlash])}`);
    return serverDomainConfig[noSlash];
  }

  LOG(`getAlternativeDomains: no mapping for "${baseDomain}" → returning []`);
  return [];
}

/**
 * Check if a base domain has any alternative domains configured.
 *
 * @param {string} baseDomain
 * @returns {boolean}
 */
export function hasAlternativeDomains(baseDomain) {
  return getAlternativeDomains(baseDomain).length > 0;
}

/**
 * Get all configured base domains (for debugging / admin UI).
 *
 * @returns {string[]}
 */
export function getConfiguredDomains() {
  return Object.keys(serverDomainConfig);
}

/**
 * Add or update a server mapping at runtime (e.g. from admin UI).
 *
 * @param {string} baseDomain
 * @param {string[]} altDomains
 */
export function setServerMapping(baseDomain, altDomains) {
  if (!baseDomain || typeof baseDomain !== 'string') return;
  serverDomainConfig[baseDomain.trim()] = Array.isArray(altDomains) ? altDomains : [];
  LOG(`setServerMapping: updated "${baseDomain}" → ${JSON.stringify(serverDomainConfig[baseDomain])}`);
}

/**
 * Remove a server mapping.
 *
 * @param {string} baseDomain
 */
export function removeServerMapping(baseDomain) {
  if (!baseDomain || typeof baseDomain !== 'string') return;
  const normalized = baseDomain.trim();
  if (serverDomainConfig[normalized]) {
    delete serverDomainConfig[normalized];
    LOG(`removeServerMapping: removed "${normalized}"`);
  }
}
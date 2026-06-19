/**
 * messageFormatter.js — Chat Message Formatter
 * Formats the credential payload into the exact structure required by Z2U chat.
 */

import { getAlternativeDomains } from './domainConfig.js';

const LOG = (...a) => console.log('[Z2U][msgFormatter]', ...a);

/**
 * Format a chat delivery message for Scenario A (alternative domains configured).
 *
 * @param {string} username
 * @param {string} password
 * @param {string} baseDomain
 * @param {string[]} altDomains
 * @returns {string}
 */
function formatWithAltDomains(username, password, baseDomain, altDomains) {
  const lines = [
    'Login Account',
    `: ${username}`,
    '',
    'Login Password',
    `: ${password}`,
    '',
    'Domain',
    `: ${baseDomain}`,
    ...altDomains.map(alt => `alternative domain : ${alt}`),
  ];
  return lines.join('\n');
}

/**
 * Format a chat delivery message for Scenario B (no alternative domains).
 *
 * @param {string} username
 * @param {string} password
 * @param {string} baseDomain
 * @returns {string}
 */
function formatWithoutAltDomains(username, password, baseDomain) {
  const lines = [
    'Login Account',
    `: ${username}`,
    '',
    'Login Password',
    `: ${password}`,
    '',
    'Domain',
    `: ${baseDomain}`,
  ];
  return lines.join('\n');
}

/**
 * Build the final chat message from parsed M3U credentials.
 *
 * @param {{ username: string, password: string, baseDomain: string }} parsed
 * @returns {string} - Formatted message ready to send via chat
 */
export function formatChatMessage(parsed) {
  if (!parsed || !parsed.username || !parsed.password || !parsed.baseDomain) {
    LOG('formatChatMessage: invalid parsed input');
    return '';
  }

  const { username, password, baseDomain } = parsed;
  const altDomains = getAlternativeDomains(baseDomain);

  const message = altDomains.length > 0
    ? formatWithAltDomains(username, password, baseDomain, altDomains)
    : formatWithoutAltDomains(username, password, baseDomain);

  LOG(`formatChatMessage: ✅ ${altDomains.length} alt domains — ${message.split('\n').length} lines`);
  return message;
}

/**
 * Build a preview of the message (for admin UI / debugging).
 *
 * @param {{ username: string, password: string, baseDomain: string }} parsed
 * @returns {string}
 */
export function previewChatMessage(parsed) {
  if (!parsed) return '(no credentials)';
  const msg = formatChatMessage(parsed);
  return msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
}
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WizytownikScanUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTACT_KEYS = ['name', 'company', 'jobTitle', 'email', 'phone', 'website', 'address', 'notes'];

  function clean(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\t ]{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();
  }

  function unfold(text) {
    return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  }

  function unescapeVcard(value) {
    return clean(String(value || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\'));
  }

  function firstProperty(lines, key, decode = true) {
    const match = lines.find(line => new RegExp('^' + key + '(?:;[^:]*)?:', 'i').test(line));
    const value = match ? match.slice(match.indexOf(':') + 1) : '';
    return decode ? unescapeVcard(value) : value;
  }

  function splitEscaped(value, separator) {
    const result = [], source = String(value || '');
    let part = '', escaped = false;
    for (const character of source) {
      if (escaped) { part += '\\' + character; escaped = false; }
      else if (character === '\\') escaped = true;
      else if (character === separator) { result.push(part); part = ''; }
      else part += character;
    }
    if (escaped) part += '\\';
    result.push(part);
    return result;
  }

  function parseQr(text) {
    const value = unfold(text);
    const result = {};
    if (/BEGIN:VCARD/i.test(value)) {
      const lines = value.split('\n').map(clean).filter(Boolean);
      const name = firstProperty(lines, 'FN');
      const structuredName = firstProperty(lines, 'N');
      const parts = splitEscaped(structuredName, ';').map(unescapeVcard).filter(Boolean);
      result.name = name || (parts.length ? [parts[1], parts[0]].filter(Boolean).join(' ') : '');
      result.company = firstProperty(lines, 'ORG');
      result.jobTitle = firstProperty(lines, 'TITLE');
      result.email = firstProperty(lines, 'EMAIL');
      result.phone = firstProperty(lines, 'TEL');
      result.website = firstProperty(lines, 'URL');
      const address = firstProperty(lines, 'ADR', false);
      result.address = splitEscaped(address, ';').map(unescapeVcard).filter(Boolean).join(', ');
      result.notes = 'Dane odczytane z QR.';
    } else if (/^MECARD:/i.test(value)) {
      const pairs = {};
      splitEscaped(value.replace(/^MECARD:/i, ''), ';').forEach(part => {
        const index = part.indexOf(':');
        if (index > 0) pairs[part.slice(0, index).toUpperCase()] = clean(part.slice(index + 1));
      });
      const nameParts = splitEscaped(pairs.N || '', ',').map(clean);
      result.name = [nameParts[1], nameParts[0]].filter(Boolean).join(' ') || pairs.N;
      result.email = pairs.EMAIL;
      result.phone = pairs.TEL;
      result.website = pairs.URL;
      result.address = pairs.ADR;
      result.notes = 'Dane odczytane z QR.';
    } else if (/^BIZCARD:/i.test(value)) {
      const pairs = {};
      value.replace(/^BIZCARD:/i, '').split(/\r?\n/).forEach(line => {
        const index = line.indexOf(':');
        if (index > 0) pairs[line.slice(0, index).toUpperCase()] = clean(line.slice(index + 1));
      });
      result.name = [pairs.X, pairs.N].filter(Boolean).join(' ');
      result.company = pairs.C;
      result.jobTitle = pairs.T;
      result.email = pairs.E;
      result.phone = pairs.B || pairs.M;
      result.website = pairs.W;
      result.address = [pairs.A1, pairs.A2, pairs.A3].filter(Boolean).join(', ');
      result.notes = 'Dane odczytane z QR.';
    } else if (/^mailto:/i.test(value)) {
      result.email = clean(value.replace(/^mailto:/i, '').split(/[?#]/)[0]);
    } else if (/^(https?:\/\/|www\.)/i.test(value)) {
      result.website = clean(value);
    }
    return mergeContactData(result);
  }

  function normaliseOcr(text) {
    return unfold(text)
      .replace(/\s*@\s*/g, '@')
      .replace(/\s*\.\s*(?=[a-z]{2,}(?:\b|\/))/gi, '.')
      .replace(/[|¦]/g, 'I')
      .replace(/[ \t]+\n/g, '\n');
  }

  function isLikelyName(line) {
    const words = clean(line).split(/\s+/);
    const forbidden = /^(tel\.?|telefon|mobile|e-?mail|www|ul\.?|adres|biuro|kontakt|sales|marketing|director|manager|specjalista)$/i;
    return words.length >= 2 && words.length <= 4 && words.every(word =>
      /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż'’-]{1,}$/.test(word) || /^[A-ZĄĆĘŁŃÓŚŹŻ]{2,}$/.test(word)
    ) && !words.some(word => forbidden.test(word));
  }

  function isRole(line) {
    return /\b(prezes|dyrektor|manager|menedżer|kierownik|specjalist[ak]|doradc[ay]|właściciel|owner|ceo|cto|cfo|sales|marketing|project|project manager|account|engineer|inżynier|technician|consultant)\b/i.test(line);
  }

  function isCompany(line) {
    return /\b(sp\.?\s*z\s*o\.?\s*o\.?|s\.a\.?|s\.k\.?a\.?|ltd\.?|llc|inc\.?|gmbh|s\.c\.?|s\.j\.?)\b/i.test(line) ||
      (/^[A-ZĄĆĘŁŃÓŚŹŻ0-9& .,'’-]{3,}$/.test(line) && !isRole(line));
  }

  function parseText(text) {
    const normalized = normaliseOcr(text);
    const lines = normalized.split('\n').map(clean).filter(Boolean);
    const email = (normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
    const phone = (normalized.match(/(?:\+?\d[\d ().-]{6,}\d)(?:\s*(?:wew\.?|ext\.?)\s*\d+)?/i) || [''])[0];
    const websitePattern = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[\w./?=&%#-]*)?/ig;
    let website = '', websiteMatch;
    while ((websiteMatch = websitePattern.exec(normalized))) {
      const candidate = websiteMatch[0].replace(/[.,;]+$/, '');
      const previous = normalized[websiteMatch.index - 1] || '';
      const following = normalized[websiteMatch.index + candidate.length] || '';
      if (previous !== '@' && following !== '@' && !/^(?:o\.o|z\.o)$/i.test(candidate)) { website = candidate; break; }
    }
    const name = lines.find(isLikelyName) || '';
    const jobTitle = lines.find(line => line !== name && isRole(line)) || '';
    const blocked = new Set([name, jobTitle]);
    const company = lines.find(line => !blocked.has(line) && !line.includes('@') && !phone.includes(line) && isCompany(line)) ||
      lines.find(line => !blocked.has(line) && !line.includes('@') && !/\d{3}/.test(line) && line.length > 2 && line.length < 70) || '';
    const address = lines.find(line => /\b(ul\.?|al\.?|pl\.?|avenue|street|\d{2}-\d{3})\b/i.test(line)) || '';
    return mergeContactData({ name, company, jobTitle, email, phone: clean(phone), website, address });
  }

  function mergeContactData() {
    const merged = {};
    Array.prototype.slice.call(arguments).forEach(source => {
      Object.keys(source || {}).forEach(key => {
        const value = clean(source[key]);
        if (value) merged[key] = value;
      });
    });
    return merged;
  }

  function uniqueText() {
    const lines = [];
    const seen = new Set();
    Array.prototype.slice.call(arguments).join('\n').split('\n').map(clean).forEach(line => {
      const key = line.toLocaleLowerCase();
      if (line && !seen.has(key)) { seen.add(key); lines.push(line); }
    });
    return lines.join('\n');
  }

  function isUsefulOcr(text) {
    const value = normaliseOcr(text);
    return value.length >= 35 || /@|\+?\d[\d ()-]{6,}\d|(?:www\.)?[a-z0-9-]+\.[a-z]{2,}/i.test(value);
  }

  return { CONTACT_KEYS, clean, normaliseOcr, parseQr, parseText, mergeContactData, uniqueText, isUsefulOcr };
});

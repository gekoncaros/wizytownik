'use strict';

const assert = require('node:assert/strict');
const utils = require('../scan-utils.js');

{
  const contact = utils.parseQr('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Anna Kowalska\r\nORG:Cortiq Sp. z o.o.\r\nTITLE:Dyrektor sprzedaży\r\nEMAIL;TYPE=WORK:anna@example.pl\r\nTEL;TYPE=CELL:+48 500 100 200\r\nURL:https://cortiq.pl\r\nADR;TYPE=WORK:;;ul. Długa 1\\; lokal 2;Chojnice;;;\r\nEND:VCARD');
  assert.equal(contact.name, 'Anna Kowalska');
  assert.equal(contact.company, 'Cortiq Sp. z o.o.');
  assert.equal(contact.email, 'anna@example.pl');
  assert.equal(contact.phone, '+48 500 100 200');
  assert.equal(contact.address, 'ul. Długa 1; lokal 2, Chojnice');
}

{
  const contact = utils.parseQr('MECARD:N:Kowalski,Jan;TEL:+48500100200;EMAIL:jan@example.pl;URL:https://example.pl;;');
  assert.equal(contact.name, 'Jan Kowalski');
  assert.equal(contact.website, 'https://example.pl');
}

{
  const contact = utils.parseText('JAN KOWALSKI\nKierownik Sprzedaży\nCORTIQ SP. Z O.O.\ne-mail: jan . kowalski @ cortiq . pl\ntel. +48 500 100 200\nul. Długa 1, 89-600 Chojnice\nwww.cortiq.pl');
  assert.equal(contact.name, 'JAN KOWALSKI');
  assert.equal(contact.jobTitle, 'Kierownik Sprzedaży');
  assert.equal(contact.email, 'jan.kowalski@cortiq.pl');
  assert.equal(contact.website, 'www.cortiq.pl');
}

assert.deepEqual(utils.mergeContactData({ name: 'Anna', company: '' }, { company: 'Cortiq' }), { name: 'Anna', company: 'Cortiq' });
assert.equal(utils.uniqueText('A\nB', 'b\nC'), 'A\nB\nC');
assert.equal(utils.isUsefulOcr('anna@example.pl'), true);

console.log('scan-utils tests passed');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneDigits } from '../src/lib/phone.ts';

test('pasted local, international and domestic-prefix phones preserve all ten digits', () => {
  for (const value of ['+77771234567', '87771234567', '+7 777 123 45 67', '7771234567']) {
    assert.equal(phoneDigits(value), '7771234567');
  }
  assert.equal(phoneDigits('+7 '), '');
  assert.equal(phoneDigits('+7 77'), '77');
  assert.equal(phoneDigits('7123456789'), '7123456789');
});

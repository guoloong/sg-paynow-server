import { test } from 'node:test';
import assert from 'node:assert/strict';
import generatePayNowCode from './generatePayNowCode';

test('should generate a paynow code with expiry date', () => {
  const res = generatePayNowCode({
    paymentAmount: 888.88,
    recipientIdentifierType: 'MOBILE',
    recipientIdentifier: '+6590901234',
    description: 'Payment reference XX12345678',
    editable: false,
    expiryDate: '20500415',
  });
  assert.equal(
    res,
    '00020101021126500009SG.PAYNOW010100211+6590901234030100408205004155204000053037025406888.885802SG5902NA6009Singapore62320128Payment reference XX1234567863046B73'
  );
});

test('should generate a paynow code without expiry date', () => {
  const res = generatePayNowCode({
    paymentAmount: 515.98,
    recipientIdentifierType: 'MOBILE',
    recipientIdentifier: '+6590901234',
    description: 'Payment reference XX12345678',
    editable: false,
  });
  assert.equal(
    res,
    '00020101021126380009SG.PAYNOW010100211+6590901234030105204000053037025406515.985802SG5902NA6009Singapore62320128Payment reference XX123456786304D3B2'
  );
});

test('should generate a paynow code for business entity (UEN)', () => {
  const res = generatePayNowCode({
    paymentAmount: 515.98,
    recipientIdentifierType: 'UEN',
    recipientIdentifier: '201023709P',
    description: 'Payment reference XX12345678',
    editable: false,
  });
  assert.equal(
    res,
    '00020101021126370009SG.PAYNOW010120210201023709P030105204000053037025406515.985802SG5902NA6009Singapore62320128Payment reference XX123456786304CFEB'
  );
});

// Regression: when the CRC's high nibble is 0, Number.prototype.toString(16)
// drops the leading zero, producing a 3-char CRC and an unparsable QR.
// The CRC here is 0E16 — must be emitted as "0E16", not "E16".
test('CRC must be zero-padded to 4 hex chars when the high nibble is 0', () => {
  const res = generatePayNowCode({
    paymentAmount: 60.64,
    recipientIdentifierType: 'UEN',
    recipientIdentifier: '201540840C',
    description: '41028',
    editable: false,
  });
  assert.equal(
    res,
    '00020101021126370009SG.PAYNOW010120210201540840C03010520400005303702540560.645802SG5902NA6009Singapore620901054102863040E16'
  );
});

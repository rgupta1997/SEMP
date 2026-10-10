import { describe, it, expect } from 'vitest';
import { aisensyDelivered, aisensyPayload, otpWhatsapp, toDestination } from './whatsapp.js';

const CONFIG = { apiKey: 'k', campaignName: 'otp' };

describe('toDestination', () => {
  it('puts the dialling code back on a stored 10-digit number', () => {
    expect(toDestination('9876543210', '91')).toBe('919876543210');
  });

  it('strips punctuation and spaces', () => {
    expect(toDestination('+91 98765 43210', '91')).toBe('919876543210');
  });

  // A number that already carries its own code must not get a second one - that is
  // the difference between reaching someone and reaching nobody.
  it('leaves a number that already has a country code alone', () => {
    expect(toDestination('919876543210', '91')).toBe('919876543210');
    expect(toDestination('14155550123', '91')).toBe('14155550123');
  });
});

describe('aisensyPayload', () => {
  it('sends the code in the body param and the copy-code button alike', () => {
    const payload = aisensyPayload({ destination: '919876543210', ...otpWhatsapp('123456') }, CONFIG) as any;

    expect(payload.templateParams).toEqual(['123456']);
    // Meta requires both for an authentication template; dropping the button is
    // how AiSensy answers 200 and WhatsApp delivers nothing.
    expect(payload.buttons).toEqual([
      { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: '123456' }] },
    ]);
  });

  it('carries the house envelope the FMS functions send', () => {
    const payload = aisensyPayload({ destination: '919876543210', templateParams: ['x'] }, CONFIG) as any;

    expect(payload).toMatchObject({
      apiKey: 'k',
      campaignName: 'otp',
      destination: '919876543210',
      userName: 'Sportagon',
      source: 'sportagon-eos',
      media: {},
      carouselCards: [],
      location: {},
    });
  });

  it('sends an empty buttons array for a template with no button params', () => {
    const payload = aisensyPayload({ destination: '919876543210', templateParams: ['x'] }, CONFIG) as any;
    expect(payload.buttons).toEqual([]);
  });
});

describe('aisensyDelivered', () => {
  it('accepts a plain success', () => {
    expect(aisensyDelivered(true, '{"success":true,"messageId":"m1"}')).toBe(true);
  });

  // What the live endpoint actually answers: the string "true", not a boolean.
  it('accepts the stringly-typed success the live endpoint sends', () => {
    expect(aisensyDelivered(true, '{"success":"true","submitted_message_id":"eb4a9b28"}')).toBe(true);
  });

  // And therefore a refusal may well be the string "false" - read as a success by
  // any check that only compares against the boolean.
  it('rejects a stringly-typed failure', () => {
    expect(aisensyDelivered(true, '{"success":"false","message":"Campaign not live"}')).toBe(false);
  });

  // The failure mode that makes an undelivered code indistinguishable from a sent
  // one: HTTP 200 with the refusal in the body.
  it('rejects a 200 that says success:false', () => {
    expect(aisensyDelivered(true, '{"success":false,"message":"Campaign not live"}')).toBe(false);
  });

  it('rejects any non-2xx', () => {
    expect(aisensyDelivered(false, '{"name":"ERR401","message":"Unauthorized"}')).toBe(false);
  });

  it('falls back to the status when the body is not JSON', () => {
    expect(aisensyDelivered(true, 'OK')).toBe(true);
    expect(aisensyDelivered(true, '')).toBe(true);
  });
});

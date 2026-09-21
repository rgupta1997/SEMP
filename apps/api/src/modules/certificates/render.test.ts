import { describe, it, expect } from 'vitest';
import { renderCertificateHtml, sampleFacts } from './render.js';
import type { TemplateDesign } from './presets.js';

// The wording a certificate shows is the whole reason it can mislead somebody -
// "Champion" printed on a participation certificate is the bug this file exists
// to catch (a category-inappropriate heading is worse than no heading at all).

const facts = sampleFacts('Test Institute');
const verifyUrl = 'https://example.test/verify/sample';

const ATHLETIC: TemplateDesign = {
  layout: 'athletic',
  heading: 'Champion',
  body: 'finished the event below at the placing shown.',
  generic_heading: 'Certificate of Recognition',
  generic_body: 'is recognised for their contribution to the event below.',
};

describe('renderCertificateHtml · category-appropriate wording', () => {
  it('uses heading/body for a winners certificate', async () => {
    const html = await renderCertificateHtml({ facts, verifyUrl, design: ATHLETIC, category: 'winners' });
    expect(html).toContain('Champion');
    expect(html).not.toContain('Certificate of Recognition');
  });

  it('uses heading/body for an awards certificate too', async () => {
    const html = await renderCertificateHtml({ facts, verifyUrl, design: ATHLETIC, category: 'awards' });
    expect(html).toContain('Champion');
  });

  it('uses generic_heading/generic_body for participation, not the achievement wording', async () => {
    const html = await renderCertificateHtml({ facts, verifyUrl, design: ATHLETIC, category: 'participation' });
    expect(html).toContain('Certificate of Recognition');
    expect(html).not.toContain('>Champion<');
  });

  it('uses generic wording for organising, officials and coaches alike', async () => {
    for (const category of ['organising', 'officials', 'coaches'] as const) {
      const html = await renderCertificateHtml({ facts, verifyUrl, design: ATHLETIC, category });
      expect(html).toContain('Certificate of Recognition');
    }
  });

  it('falls back to heading/body when a template never set a generic variant', async () => {
    const design: TemplateDesign = { layout: 'ornate', heading: 'Certificate of Honour', body: 'is presented this certificate.' };
    const html = await renderCertificateHtml({ facts, verifyUrl, design, category: 'participation' });
    expect(html).toContain('Certificate of Honour');
  });

  it('defaults to achievement wording when no category is given at all', async () => {
    const html = await renderCertificateHtml({ facts, verifyUrl, design: ATHLETIC });
    expect(html).toContain('Champion');
  });
});

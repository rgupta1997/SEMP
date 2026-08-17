import QRCode from 'qrcode';
import type { CertificateFacts } from './certificates.service.js';

// The artefact itself (J4-E6).
//
// Rendered as PRINTABLE HTML rather than a server-side PDF, deliberately:
//
//   - Lambda gives a request 15 seconds. Puppeteer is ~50MB of Chromium and several
//     seconds of cold start per document; a 300-certificate batch through it is not a
//     15-second job, it is an afternoon.
//   - Every browser already contains a very good HTML-to-PDF converter, and "Print →
//     Save as PDF" produces a real, selectable-text PDF at the right page size.
//   - The QR is a data URI, the CSS is inline, and no font is fetched - so the page
//     is genuinely self-contained. Saved to disk or emailed as an .html it still
//     renders identically offline, which a PDF-only path would also give us but at
//     twenty times the operational cost.
//
// When a true server-side PDF is needed (bulk email attachments), it plugs in behind
// this same function: the HTML is the source, and only the last hop changes.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface RenderInput {
  facts: CertificateFacts;
  verifyUrl: string;
  /** certificate_templates.design - an institution's own wording and colour. */
  design?: {
    heading?: string; body?: string; accent?: string;
    signatory_name?: string; signatory_title?: string; logo_url?: string;
  } | null;
  /** Stamped across the face when the certificate is no longer good. */
  invalid?: 'withdrawn' | 'superseded' | null;
}

export async function renderCertificateHtml(input: RenderInput): Promise<string> {
  const { facts, verifyUrl, design, invalid } = input;
  const accent = /^#[0-9a-f]{6}$/i.test(design?.accent ?? '') ? design!.accent! : '#0C5A63';

  // Embedded, not linked. A certificate that needs the network to show its own QR is
  // not a document you can keep.
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 320, errorCorrectionLevel: 'M' });

  const heading = design?.heading || 'Certificate of Achievement';
  const body = design?.body || 'is hereby recognised for the achievement below, verified against a locked result.';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(facts.serial)} — ${esc(facts.recipient_name)}</title>
<style>
  /* A4 landscape, and the same geometry on screen so what you see is what prints. */
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f4; font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif; color: #10151a; }
  .sheet {
    width: 297mm; height: 210mm; margin: 0 auto; background: #fff; position: relative;
    padding: 18mm 20mm; display: flex; flex-direction: column;
  }
  @media screen { .sheet { margin: 24px auto; box-shadow: 0 10px 40px -20px rgba(0,0,0,.5); } }
  @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; } }
  .rule { height: 6px; background: ${accent}; }
  .head { display: flex; align-items: center; gap: 14px; margin-top: 12mm; }
  .head img { height: 46px; }
  .issuer { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; letter-spacing: .16em;
            text-transform: uppercase; color: #566169; }
  h1 { font-size: 34px; margin: 9mm 0 0; letter-spacing: -.01em; }
  .recipient { font-size: 46px; margin: 6mm 0 0; color: ${accent}; }
  .body { font-size: 16px; line-height: 1.6; margin: 4mm 0 0; max-width: 165mm; color: #2b333a; }
  .title { font-size: 22px; font-weight: 700; margin: 5mm 0 0; }
  .meta { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: #566169; margin-top: 2mm; }
  .foot { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 20mm; }
  .sig { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; color: #2b333a; }
  .sig .line { width: 62mm; border-top: 1px solid #b4bfc8; margin-bottom: 4px; }
  .verify { text-align: center; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 10px; color: #566169; }
  .verify img { width: 26mm; height: 26mm; display: block; margin: 0 auto 4px; }
  .serial { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 12px; color: #566169; }
  /* A withdrawn certificate must not be printable as a clean one. */
  .void { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .void span { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 96px; font-weight: 800;
               letter-spacing: .08em; color: rgba(151,64,31,.16); transform: rotate(-22deg); text-transform: uppercase; }
</style></head>
<body>
  <div class="sheet">
    <div class="rule"></div>
    <div class="head">
      ${design?.logo_url ? `<img src="${esc(design.logo_url)}" alt="">` : ''}
      <div class="issuer">${esc(facts.organization_name)}</div>
    </div>

    <h1>${esc(heading)}</h1>
    <div class="recipient">${esc(facts.recipient_name)}</div>
    <p class="body">${esc(body)}</p>
    <div class="title">${esc(facts.title)}</div>
    <div class="meta">
      ${[facts.championship_name, facts.sport].filter(Boolean).map(esc).join(' &middot; ')}
      &middot; Issued ${esc(new Date(facts.issued_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}
    </div>

    <div class="foot">
      <div class="sig">
        <div class="line"></div>
        <div><strong>${esc(design?.signatory_name || facts.organization_name)}</strong></div>
        <div>${esc(design?.signatory_title || 'Issuing authority')}</div>
        <div class="serial" style="margin-top:6px">${esc(facts.serial)}</div>
      </div>
      <div class="verify">
        <img src="${qr}" alt="Scan to verify this certificate">
        Scan to verify
      </div>
    </div>
    ${invalid ? `<div class="void"><span>${esc(invalid)}</span></div>` : ''}
  </div>
</body></html>`;
}

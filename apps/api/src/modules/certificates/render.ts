import QRCode from 'qrcode';
import type { CertificateFacts } from './certificates.service.js';
import { layoutOf, type LayoutId, type TemplateDesign } from './presets.js';

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
//
// Six layouts live here rather than six template files, because they differ in styling
// and ornament, not in what a certificate says. The facts, the serial and the QR are
// identical in every one - a design cannot accidentally omit the things that make the
// document verifiable.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const hex = (v: unknown, fallback: string) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v) : fallback);

export interface RenderInput {
  facts: CertificateFacts;
  verifyUrl: string;
  /** certificate_templates.design - an institution's own layout, wording and colour. */
  design?: TemplateDesign | null;
  /** Stamped across the face when the certificate is no longer good. */
  invalid?: 'withdrawn' | 'superseded' | null;
  /** Gallery thumbnails: drop the shadow and the screen margin so it tiles cleanly. */
  bare?: boolean;
}

// ---- ornaments ---------------------------------------------------------------
// Inline SVG, sized in mm, currentColor-driven. Nothing here is fetched.

// A laurel half, drawn along an actual Bézier so the leaves follow the branch instead
// of bunching at one end, then mirrored for the other side.
const laurel = (accent: string) => {
  const P0 = [24, 14], P1 = [26, 44], P2 = [58, 54];
  const at = (t: number) => [
    (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t ** 2 * P2[0],
    (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t ** 2 * P2[1],
  ];
  const leaves = [0.1, 0.28, 0.46, 0.64, 0.82].map((t) => {
    const [x, y] = at(t);
    const [nx, ny] = at(Math.min(t + 0.06, 1));
    // Leaves sit across the branch, so each one is rotated by the local tangent.
    const angle = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
    const out = (o: number) => `<ellipse cx="${(x - 4.6).toFixed(1)}" cy="${(y - 1.4).toFixed(1)}" rx="5.4" ry="2.3"
        transform="rotate(${(angle + o).toFixed(0)} ${(x - 4.6).toFixed(1)} ${(y - 1.4).toFixed(1)})"/>`;
    return out(-34);
  }).join('');
  return `
<svg class="laurel" viewBox="0 0 120 62" aria-hidden="true" fill="none" stroke="${accent}"
     stroke-width="1.5" stroke-linecap="round">
  <g><path d="M24 14C26 44 38 52 58 56"/>${leaves}</g>
  <g transform="translate(120,0) scale(-1,1)"><path d="M24 14C26 44 38 52 58 56"/>${leaves}</g>
</svg>`;
};

/** A quiet divider for the ornate frame - drawn, not a font glyph that may not exist. */
const divider = (accent: string) => `
<svg class="div" viewBox="0 0 120 10" aria-hidden="true" fill="none" stroke="${accent}" stroke-width="1">
  <path d="M6 5h40M74 5h40"/><path d="M60 1.5l4.5 3.5L60 8.5 55.5 5z" fill="${accent}" stroke="none"/>
  <circle cx="50" cy="5" r="1.4" fill="${accent}" stroke="none"/><circle cx="70" cy="5" r="1.4" fill="${accent}" stroke="none"/>
</svg>`;

const seal = (accent: string) => `
<svg class="seal" viewBox="0 0 100 100" aria-hidden="true">
  <circle cx="50" cy="50" r="46" fill="none" stroke="${accent}" stroke-width="2"/>
  <circle cx="50" cy="50" r="38" fill="none" stroke="${accent}" stroke-width="0.8" stroke-dasharray="2 3"/>
  <path d="M50 22l6.9 14.9 16.1 2-11.9 11.2 3.1 16-14.2-7.9-14.2 7.9 3.1-16L27 38.9l16.1-2z"
        fill="${accent}" fill-opacity=".18" stroke="${accent}" stroke-width="1.2"/>
</svg>`;

const filigree = (accent: string) => `
<svg class="fil" viewBox="0 0 60 60" aria-hidden="true" fill="none" stroke="${accent}" stroke-width="1.2">
  <path d="M2 2h20M2 2v20"/><path d="M8 8c14 0 22 8 22 22"/><circle cx="30" cy="30" r="2.5" fill="${accent}" stroke="none"/>
</svg>`;

const ribbonBadge = (accent: string) => `
<svg class="badge" viewBox="0 0 80 110" aria-hidden="true">
  <path d="M28 62l-14 40 26-12 26 12-14-40z" fill="${accent}" fill-opacity=".22" stroke="${accent}" stroke-width="1.6"/>
  <circle cx="40" cy="38" r="32" fill="#fff" stroke="${accent}" stroke-width="2.4"/>
  <circle cx="40" cy="38" r="25" fill="none" stroke="${accent}" stroke-width="1" stroke-dasharray="3 3"/>
</svg>`;

// ---- per-layout CSS ----------------------------------------------------------

const BASE = (accent: string, ink: string, bare: boolean) => `
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${bare ? '#fff' : '#eef1f4'}; color: ${ink};
         font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* The content block is centred in the space left above the footer, rather than
     stacked from the top - a certificate with a hole in the middle of it looks
     unfinished no matter how good the type is. */
  .sheet { width: 297mm; height: 210mm; margin: 0 auto; background: #fff; position: relative;
           overflow: hidden; display: flex; flex-direction: column; justify-content: center;
           --pad-x: 20mm; --pad-b: 16mm; padding-bottom: calc(var(--pad-b) + 30mm); }
  .foot { position: absolute; left: var(--pad-x); right: var(--pad-x); bottom: var(--pad-b);
          display: flex; align-items: flex-end; justify-content: space-between; gap: 16mm;
          text-align: left; }
  @media screen { .sheet { margin: ${bare ? '0 auto' : '24px auto'};
                           box-shadow: ${bare ? 'none' : '0 10px 40px -20px rgba(0,0,0,.5)'}; } }
  @media print { body { background: #fff; } .sheet { margin: 0; box-shadow: none; } }
  .sans { font-family: ui-sans-serif, system-ui, 'Segoe UI', sans-serif; }
  .issuer { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 13px; letter-spacing: .18em;
            text-transform: uppercase; color: ${accent}; font-weight: 600; }
  .logo { height: 46px; width: auto; }
  h1 { margin: 0; letter-spacing: -.01em; font-weight: 400; }
  .recipient { color: ${accent}; }
  .body { line-height: 1.6; color: ${ink}; opacity: .82; }
  .title { font-weight: 700; }
  .meta { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; opacity: .62; }
  .sig { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12.5px; }
  .sig .line { width: 62mm; border-top: 1px solid ${ink}44; margin-bottom: 5px; }
  .serial { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 11.5px; opacity: .62; }
  .verify { text-align: center; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
            font-size: 9.5px; letter-spacing: .06em; opacity: .7; }
  .verify img { width: 26mm; height: 26mm; display: block; margin: 0 auto 4px; }
  /* A withdrawn certificate must not be printable as a clean one. */
  .void { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .void span { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 96px; font-weight: 800;
               letter-spacing: .08em; color: rgba(151,64,31,.16); transform: rotate(-22deg); text-transform: uppercase; }
`;

const LAYOUT_CSS: Record<LayoutId, (a: string, ink: string) => string> = {
  classic: (a) => `
    .sheet { --pad-x: 24mm; --pad-b: 16mm; padding: 16mm 24mm calc(16mm + 32mm);
             text-align: center; align-items: center; border: 2mm solid ${a}1a; }
    .sheet::after { content:''; position:absolute; inset:6mm; border:.6mm solid ${a}55; pointer-events:none; }
    .laurel { width: 44mm; height: 23mm; }
    h1 { font-size: 30px; margin-top: 4mm; }
    .recipient { font-size: 48px; margin: 5mm 0 0; }
    .under { width: 90mm; border-top: .5mm solid ${a}; margin: 3mm auto 0; }
    .body { font-size: 15px; max-width: 175mm; margin: 4mm auto 0; }
    .title { font-size: 21px; margin-top: 5mm; }
    .meta { margin-top: 2mm; }
    .issuer { margin-bottom: 6mm; }
    .foot { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 12mm; }
    .seal { width: 22mm; height: 22mm; justify-self: center; }
    .verify { justify-self: end; }`,

  minimal: (a, ink) => `
    .sheet { --pad-x: 30mm; --pad-b: 18mm; padding: 18mm 20mm calc(18mm + 32mm) 30mm;
             align-items: flex-start; }
    .sheet::before { content:''; position:absolute; left:0; top:0; bottom:0; width: 8mm; background: ${a}; }
    .head { display:flex; align-items:center; gap:12px; margin-bottom: 12mm; }
    h1 { font-size: 32px; font-family: ui-sans-serif, system-ui, sans-serif;
         font-weight: 300; letter-spacing: .01em; }
    .recipient { font-size: 46px; margin: 5mm 0 0; }
    .body { font-size: 15.5px; max-width: 165mm; margin-top: 4mm; }
    .title { font-size: 21px; margin-top: 5mm; }
    .meta { margin-top: 2mm; }
    .sig .line { border-color: ${ink}33; }`,

  athletic: (a, ink) => `
    /* Padded clear of the banner so the centred block lands under it, not behind it. */
    .sheet { --pad-x: 20mm; --pad-b: 16mm; padding: 56mm 20mm calc(16mm + 30mm);
             align-items: flex-start; }
    .band { position:absolute; inset: 0 0 auto 0; height: 78mm; background: ${a};
            clip-path: polygon(0 0, 100% 0, 100% 66%, 0 100%);
            padding: 14mm 20mm 0; }
    /* White on the colour field. Left as the accent it would be invisible. */
    .band .issuer { color: #fff; opacity: .9; }
    .band h1 { font-family: ui-sans-serif, system-ui, sans-serif; font-weight: 800; font-size: 52px;
               text-transform: uppercase; letter-spacing: .06em; color: #fff; margin-top: 5mm; }
    .band .logo { filter: brightness(0) invert(1); }
    .recipient { font-family: ui-sans-serif, system-ui, sans-serif; font-weight: 700; font-size: 40px;
                 color: ${ink}; }
    .rule { width: 40mm; height: 2mm; background: ${a}; margin-top: 3mm; }
    .body { font-size: 15px; max-width: 160mm; margin-top: 4mm; }
    .title { font-size: 22px; margin-top: 5mm; text-transform: uppercase; letter-spacing: .04em;
             font-family: ui-sans-serif, system-ui, sans-serif; }
    .meta { margin-top: 2mm; }`,

  ornate: (a, ink) => `
    body { background: #fbf8f2; }
    .sheet { --pad-x: 26mm; --pad-b: 18mm; background: #fdfbf6;
             padding: 18mm 26mm calc(18mm + 30mm); text-align:center; align-items:center;
             border: 1.2mm double ${a}; }
    .sheet::after { content:''; position:absolute; inset: 5mm; border: .4mm solid ${a}66; pointer-events:none; }
    .fil { position:absolute; width: 16mm; height: 16mm; }
    .fil.tl { top: 8mm; left: 8mm; } .fil.tr { top: 8mm; right: 8mm; transform: scaleX(-1); }
    .fil.bl { bottom: 8mm; left: 8mm; transform: scaleY(-1); }
    .fil.br { bottom: 8mm; right: 8mm; transform: scale(-1); }
    .issuer { margin-bottom: 8mm; }
    h1 { font-size: 34px; font-style: italic; }
    .div { width: 40mm; height: 4mm; margin-top: 3mm; }
    .recipient { font-size: 50px; margin: 3mm 0 0; font-style: italic; }
    .under { width: 100mm; border-top: .4mm solid ${a}; margin: 3mm auto 0; }
    .body { font-size: 15px; max-width: 172mm; margin: 4mm auto 0; }
    .title { font-size: 20px; margin-top: 5mm; }
    .meta { margin-top: 2mm; }
    .sig .line { border-color: ${ink}55; }`,

  institutional: (a) => `
    .sheet { --pad-x: 20mm; --pad-b: 16mm; padding: 40mm 20mm calc(16mm + 30mm);
             align-items: flex-start; }
    .band { position: absolute; inset: 0 0 auto 0; background: ${a}; color: #fff;
            padding: 9mm 20mm; display:flex; align-items:center; justify-content:space-between; gap: 16px; }
    .band .issuer { color:#fff; }
    .band .logo { filter: brightness(0) invert(1); }
    .kicker { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 11px;
              letter-spacing: .18em; text-transform: uppercase; opacity: .78; }
    h1 { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 26px; font-weight: 600; }
    .recipient { font-size: 42px; margin: 4mm 0 0; }
    .body { font-size: 14.5px; max-width: 178mm; margin-top: 4mm; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm 10mm; margin-top: 8mm;
            width: 100%; border-top: .3mm solid ${a}44; border-bottom: .3mm solid ${a}44; padding: 5mm 0; }
    .grid dt { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 10px; letter-spacing: .14em;
               text-transform: uppercase; opacity: .55; }
    .grid dd { margin: 2px 0 0; font-size: 15px; font-weight: 600; }`,

  ribbon: (a, ink) => `
    .sheet { --pad-x: 22mm; --pad-b: 16mm; padding: 16mm 22mm calc(16mm + 30mm);
             text-align:center; align-items:center; }
    .sheet::before { content:''; position:absolute; inset:0; background:
      radial-gradient(90mm 60mm at 12% -8%, ${a}14, transparent 70%),
      radial-gradient(90mm 60mm at 92% 108%, ${a}12, transparent 70%); }
    .sheet > * { position: relative; }
    .badge { width: 26mm; height: 36mm; margin: 4mm 0 1mm; }
    h1 { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 28px; font-weight: 600; margin-top: 3mm; }
    .recipient { font-size: 44px; margin: 4mm 0 0; }
    .body { font-size: 15px; max-width: 165mm; margin: 4mm auto 0; }
    .title { font-size: 19px; margin-top: 5mm; }
    .meta { margin-top: 2mm; }
    .sig .line { border-color: ${ink}33; }`,
};

// ---- per-layout markup -------------------------------------------------------

interface Parts {
  issuer: string; heading: string; recipient: string; body: string; title: string;
  meta: string; signatory: string; signatoryTitle: string; serial: string;
  logo: string; qr: string; accent: string; facts: CertificateFacts;
}

const verifyBlock = (p: Parts) => `<div class="verify"><img src="${p.qr}" alt="Scan to verify this certificate">Scan to verify</div>`;
const sigBlock = (p: Parts) => `<div class="sig"><div class="line"></div>
  <div><strong>${p.signatory}</strong></div><div>${p.signatoryTitle}</div>
  <div class="serial" style="margin-top:6px">${p.serial}</div></div>`;

const LAYOUT_BODY: Record<LayoutId, (p: Parts) => string> = {
  classic: (p) => `
    ${p.logo}<div class="issuer">${p.issuer}</div>
    ${laurel(p.accent)}
    <h1>${p.heading}</h1>
    <div class="recipient">${p.recipient}</div><div class="under"></div>
    <p class="body">${p.body}</p>
    <div class="title">${p.title}</div><div class="meta">${p.meta}</div>
    <div class="foot">${sigBlock(p)}${seal(p.accent)}${verifyBlock(p)}</div>`,

  minimal: (p) => `
    <div class="head">${p.logo}<div class="issuer">${p.issuer}</div></div>
    <h1>${p.heading}</h1>
    <div class="recipient">${p.recipient}</div>
    <p class="body">${p.body}</p>
    <div class="title">${p.title}</div><div class="meta">${p.meta}</div>
    <div class="foot">${sigBlock(p)}${verifyBlock(p)}</div>`,

  athletic: (p) => `
    <div class="band">${p.logo}<div class="issuer">${p.issuer}</div><h1>${p.heading}</h1></div>
    <div class="below">
      <div class="recipient">${p.recipient}</div><div class="rule"></div>
      <p class="body">${p.body}</p>
      <div class="title">${p.title}</div><div class="meta">${p.meta}</div>
    </div>
    <div class="foot">${sigBlock(p)}${verifyBlock(p)}</div>`,

  ornate: (p) => `
    ${filigree(p.accent).replace('class="fil"', 'class="fil tl"')}
    ${filigree(p.accent).replace('class="fil"', 'class="fil tr"')}
    ${filigree(p.accent).replace('class="fil"', 'class="fil bl"')}
    ${filigree(p.accent).replace('class="fil"', 'class="fil br"')}
    ${p.logo}<div class="issuer">${p.issuer}</div>
    <h1>${p.heading}</h1>${divider(p.accent)}
    <div class="recipient">${p.recipient}</div><div class="under"></div>
    <p class="body">${p.body}</p>
    <div class="title">${p.title}</div><div class="meta">${p.meta}</div>
    <div class="foot">${sigBlock(p)}${verifyBlock(p)}</div>`,

  institutional: (p) => `
    <div class="band">
      <div style="display:flex;align-items:center;gap:12px">${p.logo}<div class="issuer">${p.issuer}</div></div>
      <div class="kicker">Official record</div>
    </div>
    <h1>${p.heading}</h1>
    <div class="recipient">${p.recipient}</div>
    <p class="body">${p.body}</p>
    <dl class="grid">
      <div><dt>Achievement</dt><dd>${p.title}</dd></div>
      <div><dt>Event</dt><dd>${esc(p.facts.championship_name ?? '—')}</dd></div>
      <div><dt>Sport</dt><dd>${esc(p.facts.sport ?? '—')}</dd></div>
    </dl>
    <div class="foot">${sigBlock(p)}${verifyBlock(p)}</div>`,

  ribbon: (p) => `
    ${p.logo}<div class="issuer">${p.issuer}</div>
    ${ribbonBadge(p.accent)}
    <h1>${p.heading}</h1>
    <div class="recipient">${p.recipient}</div>
    <p class="body">${p.body}</p>
    <div class="title">${p.title}</div><div class="meta">${p.meta}</div>
    <div class="foot">${sigBlock(p)}${verifyBlock(p)}</div>`,
};

export async function renderCertificateHtml(input: RenderInput): Promise<string> {
  const { facts, verifyUrl, design, invalid, bare } = input;
  const layout = layoutOf(design);
  const accent = hex(design?.accent, '#0C5A63');
  const ink = hex(design?.ink, '#10151A');

  // Embedded, not linked. A certificate that needs the network to show its own QR is
  // not a document you can keep.
  const qr = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 320, errorCorrectionLevel: 'M' });

  const parts: Parts = {
    issuer: esc(facts.organization_name),
    heading: esc(design?.heading || 'Certificate of Achievement'),
    recipient: esc(facts.recipient_name),
    body: esc(design?.body || 'is hereby recognised for the achievement below, verified against a locked result.'),
    title: esc(facts.title),
    meta: [
      ...[facts.championship_name, facts.sport].filter(Boolean).map((v) => esc(v)),
      `Issued ${esc(new Date(facts.issued_on).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}`,
    ].join(' &middot; '),
    signatory: esc(design?.signatory_name || facts.organization_name),
    signatoryTitle: esc(design?.signatory_title || 'Issuing authority'),
    serial: esc(facts.serial),
    logo: design?.logo_url ? `<img class="logo" src="${esc(design.logo_url)}" alt="">` : '',
    qr, accent, facts,
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(facts.serial)} — ${esc(facts.recipient_name)}</title>
<style>${BASE(accent, ink, !!bare)}${LAYOUT_CSS[layout](accent, ink)}</style></head>
<body>
  <div class="sheet" data-layout="${layout}">
    ${LAYOUT_BODY[layout](parts)}
    ${invalid ? `<div class="void"><span>${esc(invalid)}</span></div>` : ''}
  </div>
</body></html>`;
}

/** Stand-in facts so a template can be previewed before anything is issued. */
export const sampleFacts = (organizationName: string): CertificateFacts => ({
  serial: 'CERT-26-SAMPLE-0001',
  recipient_name: 'Ananya Raghavan',
  organization_name: organizationName,
  championship_name: 'Inter-Collegiate Championship 2026',
  sport: 'Athletics',
  title: 'First Place — 400m Final',
  issued_on: new Date().toISOString(),
});

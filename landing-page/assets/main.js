/* ─── Config ────────────────────────────────────────────────────────────────── */
// window.SEMP_APP_URL and window.SEMP_API_URL are injected by the <script> block
// just before this file is loaded (see index.html).
const APP_URL = (window.SEMP_APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const API_URL = (window.SEMP_API_URL ?? 'http://localhost:4000') + '/api';

/* ─── Navigation helpers ─────────────────────────────────────────────────────── */
function goLogin()  { window.location.href = APP_URL + '/'; }
function goSignup() { window.location.href = APP_URL + '/?mode=signup'; }

/* ─── Theme ──────────────────────────────────────────────────────────────────── */
const THEME_KEY = 'semp_theme';

function getStoredTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark') return v;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  // swap logo images
  document.querySelectorAll('[data-logo-dark]').forEach(el => {
    el.src = theme === 'dark' ? el.dataset.logoDark : el.dataset.logoLight;
  });
  // update toggle button label
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
}

let currentTheme = getStoredTheme();
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(currentTheme);

  const btn = document.getElementById('theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
  });
});

/* ─── Smooth scroll ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[data-scroll]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      const target = document.getElementById(el.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });
});

/* ─── Login / Signup buttons ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-action="login"]').forEach(el => {
    el.addEventListener('click', goLogin);
  });
  document.querySelectorAll('[data-action="signup"]').forEach(el => {
    el.addEventListener('click', goSignup);
  });
});

/* ─── Feature tab selector ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const items   = document.querySelectorAll('.feature-item');
  const panels  = document.querySelectorAll('.preview-panel');
  const crumbEl = document.getElementById('preview-crumb');

  function setActive(idx) {
    items.forEach((item, i) => item.classList.toggle('active', i === idx));
    panels.forEach((panel, i) => panel.classList.toggle('active', i === idx));
    if (crumbEl) crumbEl.textContent = items[idx]?.dataset.crumb ?? '';
  }

  items.forEach((item, idx) => {
    item.addEventListener('click', () => setActive(idx));
  });

  if (items.length) setActive(0);
});

/* ─── Demo request form ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const form       = document.getElementById('demo-form');
  const formWrap   = document.getElementById('demo-form-wrap');
  const successEl  = document.getElementById('demo-success');
  const errorEl    = document.getElementById('demo-error');
  const submitBtn  = document.getElementById('demo-submit');

  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (errorEl) errorEl.textContent = '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

    const data = {
      name:         form.elements['demo-name']?.value.trim(),
      organization: form.elements['demo-org']?.value.trim() || undefined,
      role:         form.elements['demo-role']?.value || undefined,
      sport:        form.elements['demo-sport']?.value.trim() || undefined,
      email:        form.elements['demo-email']?.value.trim(),
      phone:        form.elements['demo-phone']?.value.trim() || undefined,
    };

    if (!data.name || !data.email) {
      if (errorEl) errorEl.textContent = 'Please enter your name and work email.';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Book a demo <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>'; }
      return;
    }

    try {
      const res = await fetch(API_URL + '/demo-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.text();
        let msg = 'Something went wrong. Please try again.';
        try { msg = JSON.parse(body)?.error?.message ?? msg; } catch {}
        throw new Error(msg);
      }
      if (formWrap) formWrap.style.display = 'none';
      if (successEl) successEl.style.display = 'flex';
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message ?? 'Something went wrong. Please try again.';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Book a demo <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>'; }
    }
  });
});

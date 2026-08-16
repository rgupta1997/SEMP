import { test, expect, type Page } from '@playwright/test';

// Theming consistency.
//
// The app ships light and dark, and the risk is not that dark mode is missing - it is
// that a screen built quickly hardcodes a colour and stays light while everything
// around it flips. These tests assert the *mechanism* rather than exact hex values, so
// they keep working when the palette is retuned.

const THEME_KEY = 'semp_theme';

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key as string, value as string);
  }, [THEME_KEY, theme]);
}

const bgOf = (page: Page, selector = 'body') =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

// Parse "rgb(15, 23, 42)" -> perceived lightness 0..255.
function lightness(rgb: string): number {
  const m = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return -1;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

test.describe('theming', () => {
  test('the sign-in screen honours the dark preference', async ({ page }) => {
    await setTheme(page, 'dark');
    await page.goto('/login');
    const dark = lightness(await bgOf(page, '.auth'));

    await page.context().clearCookies();
    await setTheme(page, 'light');
    await page.goto('/login');
    const light = lightness(await bgOf(page, '.auth'));

    expect(dark, `dark bg lightness ${dark} should be darker than light ${light}`).toBeLessThan(light);
  });

  test('the document root carries the theme class the CSS keys off', async ({ page }) => {
    await setTheme(page, 'dark');
    await page.goto('/login');
    const cls = await page.locator('html').getAttribute('class');
    expect(cls ?? '').toContain('dark');
  });

  test('no screen leaves a pure-white panel in dark mode', async ({ page }) => {
    await setTheme(page, 'dark');
    await page.goto('/login');
    // Any element painting pure white in dark mode is a hardcoded colour that missed
    // the dark: variant - the single most common theming defect in this codebase's
    // hand-rolled UI.
    const offenders = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*')).slice(0, 4000)) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg === 'rgb(255, 255, 255)') {
          const cls = (el as HTMLElement).className?.toString().slice(0, 60) ?? '';
          out.push(`${el.tagName.toLowerCase()}.${cls}`);
        }
      }
      return out.slice(0, 12);
    });
    expect(offenders, `pure-white elements in dark mode:\n${offenders.join('\n')}`).toHaveLength(0);
  });

  test('brand blue is used for the primary action, consistently', async ({ page }) => {
    await page.goto('/login');
    const cta = page.getByRole('button', { name: /continue|create my account/i }).first();
    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    // The landing/auth palette's brand blue.
    expect(bg).toBe('rgb(0, 74, 173)');
  });
});

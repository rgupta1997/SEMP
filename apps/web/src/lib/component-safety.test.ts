import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Two crashes reached the browser in one week, both invisible to `tsc`, the build
// and every API test. Nothing in CI renders a component, so nothing could catch
// either:
//
//   1. A hook after an early return.
//      `InvitePanel` branched on fetched data before six later hooks. On the first
//      render the data was undefined so all of them ran; the moment it resolved the
//      early return fired and React counted three where it had seen nine -
//      "Rendered fewer hooks than expected".
//
//   2. A `useState` read above its own declaration.
//      `TeamsPage` filtered a list with `playsFor` two hundred lines before
//      declaring it. TypeScript stayed silent because the read sits inside a
//      `.filter()` callback and it assumes callbacks may run later - but `.filter()`
//      runs immediately, so the page threw "Cannot access 'playsFor' before
//      initialization" on first paint.
//
// A rendering test would catch both and more, and is the right answer eventually.
// This is the answer that needs no new dependency and runs today: a static read of
// every component in the app, checking the two shapes that actually broke.
//
// It parses the real body - tracking bracket depth from the signature - rather than
// guessing by indentation. The indentation version reported eight false positives
// from multi-line prop destructuring, and a check that cries wolf is a check
// somebody deletes.

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const HOOK = /\b(useState|useEffect|useMemo|useCallback|useRef|useReducer|useContext|useLayoutEffect|use[A-Z]\w*)\s*[(<]/;
const COMPONENT = /(?:^|\n)(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)|const\s+([A-Z]\w*)\s*[:=][^\n]*?=>)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

/** Strip comments and string/template literals so scanning sees only code. */
function blank(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:\\.|[^'\\])*'/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:\\.|[^"\\])*"/g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Fn { name: string; body: string; bodyStart: number; lineOf: (i: number) => number }

/**
 * Every top-level component function with its real body.
 *
 * The body begins at the first `{` once the signature's parentheses have closed,
 * which is what makes multi-line prop destructuring part of the SIGNATURE rather
 * than of the body - the distinction the indentation-based version got wrong.
 */
function components(raw: string): Fn[] {
  const code = blank(raw);
  const out: Fn[] = [];
  COMPONENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMPONENT.exec(code)) !== null) {
    const name = m[1] ?? m[2];
    let i = m.index + m[0].length;
    let paren = 0;
    // Walk to the `{` that opens the body.
    while (i < code.length) {
      const c = code[i];
      if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === '{' && paren <= 0) break;
      i++;
    }
    if (i >= code.length) continue;
    const bodyStart = i + 1;
    let depth = 1;
    let j = bodyStart;
    while (j < code.length && depth > 0) {
      if (code[j] === '{') depth++;
      else if (code[j] === '}') depth--;
      j++;
    }
    const body = code.slice(bodyStart, j - 1);
    const before = code.slice(0, bodyStart);
    const baseLine = before.split('\n').length;
    out.push({
      name,
      body,
      bodyStart,
      lineOf: (idx) => baseLine + body.slice(0, idx).split('\n').length - 1,
    });
  }
  return out;
}

/** Offsets of statements at the body's own depth - not inside nested braces. */
function topLevelStatements(body: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if ((c === ';' || c === '\n') && depth === 0) {
      const text = body.slice(start, i).trim();
      if (text) out.push({ text, at: start });
      start = i + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) out.push({ text: tail, at: start });
  return out;
}

const files = walk(join(ROOT, 'pages')).concat(walk(join(ROOT, 'components')));

describe('components cannot crash on their own shape', () => {
  it('finds the app to check (guards the parser itself)', () => {
    // Without this the two suites below pass vacuously the day the glob breaks.
    expect(files.length).toBeGreaterThan(40);
    const parsed = files.flatMap((f) => components(readFileSync(f, 'utf8')));
    expect(parsed.length).toBeGreaterThan(60);
  });

  it('never calls a hook after an early return', () => {
    const bad: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      for (const fn of components(raw)) {
        const stmts = topLevelStatements(fn.body);
        let returnedAt: number | null = null;
        for (const st of stmts) {
          const isReturn = /^return\b/.test(st.text) || /^if\s*\([\s\S]*\)\s*return\b/.test(st.text);
          // `return useMemo(...)` is a return CONTAINING a hook - unconditional, and
          // not an early return with hooks after it.
          if (isReturn && !HOOK.test(st.text)) { returnedAt = returnedAt ?? fn.lineOf(st.at); continue; }
          if (returnedAt !== null && HOOK.test(st.text)) {
            bad.push(`${file.split(/[\\/]/).pop()} · ${fn.name}(): hook on line ${fn.lineOf(st.at)}, after an early return on line ${returnedAt}`);
          }
        }
      }
    }
    expect(bad, `Hooks must run on every render.\n${bad.join('\n')}`).toEqual([]);
  });

  it('never reads a useState value above its own declaration', () => {
    const bad: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      for (const fn of components(raw)) {
        const stmts = topLevelStatements(fn.body);
        stmts.forEach((st, idx) => {
          const decl = /^const\s*\[\s*(\w+)\s*[,\]]/.exec(st.text);
          if (!decl || !/useState|useReducer/.test(st.text)) return;
          const name = decl[1];
          // Not preceded by a dot or a word character: `e.status` is a PROPERTY of
          // something else, not a read of the local `status`, and counting it
          // reported a clean file as broken.
          const used = new RegExp(`(?<![.?\\w$])\\b${name}\\b`);
          for (let k = 0; k < idx; k++) {
            if (used.test(stmts[k].text)) {
              bad.push(`${file.split(/[\\/]/).pop()} · ${fn.name}(): "${name}" is read on line ${fn.lineOf(stmts[k].at)} but declared on line ${fn.lineOf(st.at)}`);
              break;
            }
          }
        });
      }
    }
    expect(bad, `A const is in its temporal dead zone until declared, and tsc misses this inside callbacks.\n${bad.join('\n')}`).toEqual([]);
  });
});

/*
 * The CLI's manifest: out/<key>.manifest.json, next to the reports and credentials
 * (all gitignored - a client's sheet carries real names and phone numbers). The API
 * keeps the same object on its event_setups row instead; the engine cannot tell.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normaliseManifest, type Manifest, type ManifestStore } from '../../src/modules/event-setup/engine.js';

export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

export const manifestPath = (key: string) => path.join(OUT, `${key}.manifest.json`);

export function fileManifestStore(key: string): ManifestStore {
  const file = manifestPath(key);
  return {
    async load(): Promise<Manifest> {
      return normaliseManifest(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
    },
    async save(m: Manifest): Promise<void> {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(file, JSON.stringify(m, null, 2));
    },
  };
}

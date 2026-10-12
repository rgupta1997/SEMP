/// <reference types="vite/client" />

// The app's build-time contract.
//
// Note the ABSENCE of an `[key: string]: any` index signature - that is the entire
// point of this file. Without it, `import.meta.env.VITE_TYPO` typed as `any` and a
// misspelled variable read as `undefined` at runtime with no complaint from tsc.
// Declaring the four real ones turns that into a compile error. Do not add an index
// signature back; add the variable here instead.
//
// All optional, and every read must handle `undefined`: Vite substitutes these at
// BUILD time, so a variable that was not set in the build environment is simply
// absent from the bundle. There is deliberately nothing here for AppSync - live
// notification delivery learns its endpoint from the API at runtime, so replacing
// the stack never requires a frontend rebuild.
interface ImportMetaEnv {
  /** API origin. Falls back to http://localhost:4000 at its two call sites. */
  readonly VITE_API_URL?: string;
  /** Marketing site origin. Falls back to '/' at its two call sites. */
  readonly VITE_LANDING_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

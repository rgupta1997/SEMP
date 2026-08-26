// The client half deliberately re-exports the pure core and nothing else.
//
// Entitlement state is derived from the tier the app already holds in its auth
// context - there is nothing to fetch, so there is no query hook here and no
// react-query dependency. What matters is that the lock a person sees and the
// guard that refuses them read ONE registry; importing it from here is what
// makes that true.
export * from '../core/index.js';

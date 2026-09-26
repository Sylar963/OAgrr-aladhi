import type {} from 'vitest/jsdom';

// Node's storage globals can shadow jsdom's isolated browser storage.
Object.defineProperties(globalThis, {
  localStorage: { configurable: true, value: jsdom.window.localStorage },
  sessionStorage: { configurable: true, value: jsdom.window.sessionStorage },
});

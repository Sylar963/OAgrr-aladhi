import react from '@vitejs/plugin-react-swc';
import { defineConfig, type Plugin } from 'vite';
import { cspMeta } from './security/policy';

/** Fallback if a deploy ever loses the headers: the policy still governs scripts and sockets. */
function metaCsp(): Plugin {
  return {
    name: 'vault-meta-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: cspMeta() },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

export default defineConfig({
  plugins: [react(), metaCsp()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // The polyfill is injected as code we don't otherwise review; every target browser has native
    // modulepreload.
    modulePreload: { polyfill: false },
  },
  server: { port: 5174, strictPort: true },
});

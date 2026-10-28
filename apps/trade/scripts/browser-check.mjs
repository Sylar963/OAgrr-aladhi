#!/usr/bin/env node
/**
 * Real-browser check of the built vault (B0 T07). Serves `dist/` over HTTPS with exactly the
 * headers in `vercel.json`, drives headless Chromium over CDP (Node's built-in WebSocket, no
 * dependencies), runs the key flow through the UI, then attacks the page.
 *
 *   pnpm --filter @oggregator/trade build && pnpm --filter @oggregator/trade check:browser
 *
 * CHROME=/path/to/chrome overrides the browser. Exits non-zero on any failure.
 */
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(appDir, 'dist');
const vercel = JSON.parse(readFileSync(join(appDir, 'vercel.json'), 'utf8'));
const headers = vercel.headers[0].headers;

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), '.cache', 'ms-playwright');
  const candidates = existsSync(cache)
    ? execFileSync('find', [cache, '-maxdepth', '3', '-name', 'headless_shell', '-o', '-maxdepth', '3', '-name', 'chrome', '-type', 'f'])
        .toString()
        .split('\n')
        .filter(Boolean)
    : [];
  if (candidates[0]) return candidates[0];
  throw new Error('No Chromium found; set CHROME=/path/to/chrome');
}

// --- HTTPS server with the production headers -------------------------------------------------
const certDir = mkdtempSync(join(tmpdir(), 'vault-cert-'));
execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
  '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'),
], { stdio: 'ignore' });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(
  { key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) },
  (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'https://x').pathname));
    let file = join(distDir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(distDir) || !existsSync(file)) file = join(distDir, 'index.html');
    for (const { key, value } of headers) res.setHeader(key, value);
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  },
);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `https://localhost:${server.address().port}`;

// --- Chromium + CDP --------------------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'vault-profile-'));
const chrome = spawn(findChrome(), [
  '--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--ignore-certificate-errors', '--no-first-run', '--no-sandbox', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const browserWs = await new Promise((resolve, reject) => {
  let buffer = '';
  chrome.stderr.on('data', (chunk) => {
    buffer += chunk;
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
    if (match) resolve(match[1]);
  });
  setTimeout(() => reject(new Error('Chromium did not start')), 15_000);
});

const targets = await (await fetch(browserWs.replace('ws://', 'http://').replace(/\/devtools\/browser\/.*/, '/json'))).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
});
function cdp(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}
async function evaluate(expression) {
  const res = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.exception?.description ?? 'error' };
  return { value: res.result?.result?.value };
}
async function waitFor(expression, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if ((await evaluate(expression)).value) return true;
    await sleep(100);
  }
  return false;
}
async function navigate(url) {
  consoleErrors.length = 0;
  await cdp('Page.navigate', { url });
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('h1')`);
}

// Sets a React-controlled field the way a user would.
const fill = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const click = (expression) => evaluate(`(() => { const el = ${expression}; el.click(); return true; })()`);
const buttonByText = (text) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

try {
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');

  // 1. Load
  await navigate(origin);
  check('page renders', (await evaluate(`document.querySelector('h1').textContent`)).value === 'oggregator vault');
  check('no CSP or Trusted Types violations on load', consoleErrors.length === 0, consoleErrors.join(' | '));

  // 2. Key flow through the UI: real WebCrypto + IndexedDB
  const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const passphrase = 'browser check passphrase';
  await fill('input[autocomplete="off"]', 'KCHECK1');
  await fill('textarea', pem);
  await evaluate(`(() => {
    const [a, b] = document.querySelectorAll('input[autocomplete="new-password"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const el of [a, b]) { set.call(el, ${JSON.stringify(passphrase)}); el.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  })()`);
  await click(`document.querySelector('label.check input')`);
  await click(buttonByText('Save testnet key'));
  check(
    'key imported and listed as a locked testnet key',
    await waitFor(`!!document.querySelector('.key[data-network="test"]') && document.querySelector('.key .state').textContent === 'Locked'`, 30_000),
  );

  const stored = await evaluate(`new Promise((resolve) => {
    const req = indexedDB.open('ogg-vault');
    req.onsuccess = () => {
      const all = req.result.transaction('keys').objectStore('keys').getAll();
      all.onsuccess = () => resolve(JSON.stringify(all.result));
    };
  })`);
  check('IndexedDB holds only the sealed key', !!stored.value && !stored.value.includes('PRIVATE KEY') && stored.value.includes('"iterations":600000'));

  await fill('.key input[type="password"]', 'wrong passphrase!');
  await click(buttonByText('Unlock'));
  check('wrong passphrase is refused', await waitFor(`!!document.querySelector('.key .error')`));

  await fill('.key input[type="password"]', passphrase);
  await click(buttonByText('Unlock'));
  check('correct passphrase unlocks', await waitFor(`document.querySelector('.key .state')?.textContent === 'Unlocked'`, 30_000));

  await navigate(origin);
  check(
    'reload keeps the key but locked',
    await waitFor(`document.querySelector('.key .state')?.textContent === 'Locked'`),
  );

  // 3. Attacks. Each runs from a timer, as ordinary page code: code evaluated directly by
  // DevTools is exempt from the page's eval policy, which would make the check meaningless.
  consoleErrors.length = 0;
  const attack = (body) =>
    evaluate(`new Promise((resolve) => setTimeout(() => {
      try { resolve(String((() => { ${body} })())); } catch (e) { resolve('blocked:' + e.name); }
    }, 0))`);

  const inline = await attack(`const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.body.appendChild(s);
    return window.__pwned === 1 ? 'ran' : 'did not run';`);
  check('inline script cannot run', inline.value !== 'ran', inline.value ?? inline.error);

  const html = await attack(`document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__pwned2=1">');
    return 'inserted';`);
  check('HTML string injection is refused by Trusted Types', String(html.value).startsWith('blocked'), html.value);

  const evalCheck = await attack(`return new Function('return 1')() === 1 ? 'ran' : 'no';`);
  check('eval-style code is blocked', String(evalCheck.value).startsWith('blocked'), evalCheck.value);

  const timerString = await attack(`setTimeout('window.__pwned3 = 1', 0); return 'scheduled';`);
  await sleep(200);
  const pwned3 = await evaluate(`window.__pwned3 === 1`);
  check('string timers do not run', pwned3.value !== true, timerString.value);

  const external = await evaluate(`fetch('https://example.com/').then(() => 'reached', () => 'blocked')`);
  check('fetch to an unlisted origin is blocked', external.value === 'blocked');

  const evil = await evaluate(`new Promise((resolve) => {
    try { const s = new WebSocket('wss://echo.websocket.org'); s.onopen = () => resolve('opened'); s.onerror = () => resolve('blocked'); }
    catch (e) { resolve('blocked'); }
    setTimeout(() => resolve('blocked'), 5000);
  })`);
  check('socket to an unlisted origin is blocked', evil.value === 'blocked');

  const thalex = await evaluate(`new Promise((resolve) => {
    const s = new WebSocket('wss://testnet.thalex.com/ws/api/v2');
    s.onopen = () => { s.close(); resolve('opened'); };
    s.onerror = () => resolve('failed');
    setTimeout(() => resolve('timeout'), 10000);
  })`);
  check('socket to Thalex testnet is allowed', thalex.value === 'opened', thalex.value);

  const framed = await evaluate(`(() => window.top === window)()`);
  check('page is top-level', framed.value === true);
  const served = await evaluate(`fetch(location.href).then((r) => [r.headers.get('content-security-policy'), r.headers.get('cross-origin-opener-policy'), r.headers.get('x-frame-options')])`);
  const [csp, coop, xfo] = served.value ?? [];
  check('served CSP is enforced with frame-ancestors none', typeof csp === 'string' && csp.includes("frame-ancestors 'none'"));
  check('COOP same-origin and frame denial are served', coop === 'same-origin' && xfo === 'DENY');
} finally {
  ws.close();
  chrome.kill('SIGKILL');
  server.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(certDir, { recursive: true, force: true });
}

console.log(failures.length === 0 ? '\nAll browser checks passed.' : `\n${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);

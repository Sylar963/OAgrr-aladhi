import './zod-csp';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IndexedDbKeyRecordStore } from './vault/indexeddb-store';
import { Vault } from './vault/vault';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found');

const vault = new Vault({ store: new IndexedDbKeyRecordStore() });

for (const event of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(event, () => vault.touch(), { passive: true });
}
// Leaving the page (tab closed, navigated away, app backgrounded on mobile) locks every key.
window.addEventListener('pagehide', () => vault.lock());

createRoot(root).render(
  <StrictMode>
    <App vault={vault} />
  </StrictMode>,
);

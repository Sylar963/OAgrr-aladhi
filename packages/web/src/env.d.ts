/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_TRADFI_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

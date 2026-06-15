/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_TRADFI_API_BASE: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  readonly VITE_THALEX_REF_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

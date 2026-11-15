/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOOKS_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_E2E_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface NetworkInformationInfo {
  readonly effectiveType?: string;
  readonly downlink?: number;
  readonly rtt?: number;
  readonly saveData?: boolean;
}

interface Window {
  __BOOKISH_BOOT_START__?: number;
  __BOOKISH_BOOTED__?: boolean;
  __bookishHardResetAndReload?: () => void;
  __reportClientLog?: (
    level: string,
    message: string,
    stack?: string,
    meta?: unknown,
  ) => void;
  __nativeFetch?: typeof fetch;
}

interface Navigator {
  readonly connection?: NetworkInformationInfo;
}

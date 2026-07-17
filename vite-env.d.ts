/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PORTONE_STORE_ID: string;
  readonly VITE_PORTONE_CHANNEL_KEY: string;
  readonly VITE_PORTONE_CARD_CHANNEL_KEY?: string;
  readonly VITE_PORTONE_VIRTUAL_ACCOUNT_CHANNEL_KEY?: string;
  readonly VITE_PORTONE_KAKAOPAY_CHANNEL_KEY?: string;
  readonly VITE_PORTONE_WEBHOOK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

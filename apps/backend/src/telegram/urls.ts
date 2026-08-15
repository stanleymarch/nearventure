import { publicBaseUrl } from '../common/app-config';

/** Shared URL helpers for the Telegram bot. */
/** Returns no URL until a non-production deployment explicitly configures one. */
export function miniAppUrl(): string | undefined {
  const base = publicBaseUrl();
  return base ? `${base}/tg/` : undefined;
}

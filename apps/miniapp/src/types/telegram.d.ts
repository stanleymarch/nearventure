/**
 * Minimal Telegram WebApp SDK typings (subset we use).
 * The full object is injected by telegram-web-app.js as window.Telegram.WebApp.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  bottom_bar_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  section_separator_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
}

export interface SafeAreaInset {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface PopupButton {
  id?: string;
  type: 'default' | 'ok' | 'close' | 'cancel' | 'destructive';
  text?: string;
}

export interface PopupParams {
  title?: string;
  message: string;
  buttons?: PopupButton[];
}

export interface MainButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
  has_shine_effect?: boolean;
}

interface MainButtonLike {
  text: string;
  color: string;
  textColor: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  setText: (text: string) => typeof this;
  show: () => typeof this;
  hide: () => typeof this;
  enable: () => typeof this;
  disable: () => typeof this;
  showProgress: (leaveActive?: boolean) => typeof this;
  hideProgress: () => typeof this;
  setParams: (params: MainButtonParams) => typeof this;
  onClick: (cb: () => void) => typeof this;
  offClick: (cb: () => void) => typeof this;
}

interface SimpleButtonLike {
  show: () => typeof this;
  hide: () => typeof this;
  onClick: (cb: () => void) => typeof this;
  offClick: (cb: () => void) => typeof this;
}

export interface HapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: TelegramUser;
    start_param?: string;
    auth_date?: number;
    hash?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  isFullscreen: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;

  ready: () => void;
  expand: () => void;
  close: () => void;

  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  setBottomBarColor?: (color: string) => void;

  enableClosingConfirmation: () => void;
  disableClosingConfirmation: () => void;

  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;

  showAlert: (message: string, cb?: () => void) => void;
  showConfirm: (message: string, cb?: (ok: boolean) => void) => void;
  showPopup: (params: PopupParams, cb?: (id: string) => void) => void;

  sendData: (data: string) => void; // ≤ 4096 bytes
  readTextFromClipboard: (cb?: (text: string | null) => void) => void;

  onEvent: (event: string, cb: (...args: any[]) => void) => void;
  offEvent: (event: string, cb: (...args: any[]) => void) => void;

  MainButton: MainButtonLike;
  SecondaryButton: MainButtonLike;
  BackButton: SimpleButtonLike;
  SettingsButton: SimpleButtonLike;
  HapticFeedback: HapticFeedback;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

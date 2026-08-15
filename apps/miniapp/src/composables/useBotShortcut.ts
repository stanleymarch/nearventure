import { onMounted, onUnmounted } from 'vue';
import { useTelegram } from './useTelegram';

/**
 * Mounts the persistent "💬 К боту" secondary button on the current view.
 *
 * Why a composable (not a free-standing call in <script setup>):
 *  - Guarantees cleanup on unmount so two screens don't fight for the
 *    secondary button slot. Without this, navigating from CatalogView to
 *    WizardView could leak the previous screen's onClick.
 *  - One-line usage per view: `useBotShortcut()` after the useTelegram()
 *    import. Default command is 'start' (lands in the home menu of the
 *    bot); pass 'route' or 'nearby' to deep-link a specific action.
 *
 * The button is provided by Telegram's SecondaryButton (Bot API 7.7+). On
 * older runtimes the underlying composable no-ops, so this is safe to call
 * unconditionally.
 *
 * Usage:
 *   <script setup>
 *   useBotShortcut();            // returns to bot home
 *   // or:
 *   useBotShortcut('route');     // opens chat + sends /route
 *   </script>
 */
export function useBotShortcut(command: 'start' | 'route' | 'nearby' = 'start'): void {
  const { setSecondaryButton, openBot } = useTelegram();
  let cleanup: (() => void) | undefined;

  onMounted(() => {
    cleanup = setSecondaryButton({
      text: '💬 К боту',
      onClick: () => openBot(command),
    });
  });
  onUnmounted(() => {
    cleanup?.();
  });
}

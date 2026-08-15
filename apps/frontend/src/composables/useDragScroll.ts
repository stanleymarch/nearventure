import { onMounted, onBeforeUnmount, ref, type Ref } from 'vue';

/**
 * useDragScroll — pointer-drag для горизонтальных каруселей.
 *
 * Свайп пальцем (touch) + перетаскивание мышью (desktop) поверх нативного
 * `overflow-x-auto`. Нативный скролл остаётся (тачпад, колёсико, клавиатура),
 * а мышь получает drag-with-grabbing-cursor. После перетаскивания клик по
 * карточке подавляется, чтобы не открывалась деталь маршрута, которую
 * пользователь «случайно» утащил.
 *
 * Usage:
 *   const rail = useDragScroll<HTMLElement>()
 *   <div ref="rail" class="flex gap-2 overflow-x-auto">…</div>
 */
export function useDragScroll<T extends HTMLElement = HTMLElement>(): Ref<T | null> {
  // `as unknown as` bypasses Vue's UnwrapRef<T> recursion that otherwise
  // widens T to HTMLElement for the generic constraint.
  const el = ref<T | null>(null) as unknown as Ref<T | null>;
  let down = false;
  let startX = 0;
  let startScroll = 0;
  let moved = false;
  let pointerId = -1;

  function onDown(e: PointerEvent) {
    // Only primary button / touch; ignore right/middle click.
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const node = el.value;
    if (!node) return;
    down = true;
    moved = false;
    startX = e.clientX;
    startScroll = node.scrollLeft;
    pointerId = e.pointerId;
    node.setPointerCapture?.(e.pointerId);
    // Grab cursor only for mouse; touch keeps default.
    if (e.pointerType === 'mouse') node.classList.add('cursor-grabbing');
  }

  function onMove(e: PointerEvent) {
    if (!down) return;
    const node = el.value;
    if (!node) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    node.scrollLeft = startScroll - dx;
  }

  function onUp(e: PointerEvent) {
    if (!down) return;
    down = false;
    const node = el.value;
    if (!node) return;
    node.classList.remove('cursor-grabbing');
    node.releasePointerCapture?.(pointerId);
    pointerId = -1;
  }

  /** Suppress the click that fires right after a drag so cards don't open. */
  function onClickCapture(e: MouseEvent) {
    if (moved) {
      e.preventDefault();
      e.stopPropagation();
      moved = false;
    }
  }

  onMounted(() => {
    const node = el.value;
    if (!node) return;
    node.addEventListener('pointerdown', onDown);
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onUp);
    node.addEventListener('pointercancel', onUp);
    node.addEventListener('click', onClickCapture, true);
  });

  onBeforeUnmount(() => {
    const node = el.value;
    if (!node) return;
    node.removeEventListener('pointerdown', onDown);
    node.removeEventListener('pointermove', onMove);
    node.removeEventListener('pointerup', onUp);
    node.removeEventListener('pointercancel', onUp);
    node.removeEventListener('click', onClickCapture, true);
  });

  return el;
}

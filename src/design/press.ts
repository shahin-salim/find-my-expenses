/**
 * How a tappable thing answers a finger, decided once.
 *
 * This was written after counting: eleven of the app's sixty `Pressable`s
 * gave any feedback at all, and those eleven did not agree — three different
 * opacities and two different tints between them. Everything else did
 * nothing, so roughly half of what the user touched looked identical whether
 * it had registered the tap or not. A target that does not react reads as
 * broken, and it reads that way exactly when the reassurance matters most:
 * on the tap that is about to open a screen or rewrite the list.
 *
 * Two shapes, because there are two kinds of target.
 *
 * `pressedFill` tints the whole target, and belongs to anything whose
 * resting background is the page or a plain card — rows, menu items, icon
 * buttons, list cells. The tint has to be put on the element that owns the
 * target's full bounds, padding included, or it lands on part of what the
 * finger is covering and leaves the rest looking unpressed.
 *
 * `pressedDim` fades it, and belongs to the targets a tint cannot work on:
 * anything already carrying a strong fill of its own — a selected chip is
 * near-black, and tinting it pale would read as it being deselected — and
 * anything that is mostly text or icon, where a background appearing from
 * nowhere is louder than the tap deserves.
 *
 * Both return `null` rather than an empty object so they can be dropped
 * straight into a style array alongside the `StyleSheet` entry.
 */

import type { Theme } from './theme';

/**
 * Deliberately heavier than the 0.7 the buttons used to use on their own.
 * At 0.7 a white chip on a cream background barely moves, which is the
 * complaint this is answering rather than a style to be preserved.
 */
export const PRESSED_OPACITY = 0.6;

export function pressedFill(
  theme: Theme,
  pressed: boolean,
): { backgroundColor: string } | null {
  return pressed ? { backgroundColor: theme.color.surfaceMuted } : null;
}

export function pressedDim(pressed: boolean): { opacity: number } | null {
  return pressed ? { opacity: PRESSED_OPACITY } : null;
}

// Millennium build alias for "@decky/ui". Millennium's client library wraps the same Steam UI
// components, so the runtime values pass straight through. Where its typings are narrower than
// Decky's (e.g. Focusable lacks preferredFocus/navEntryPreferPosition, which Steam's component
// accepts), the Decky typings are kept so the shared source type-checks unchanged.
import { DropdownItem as MillenniumDropdownItem, Focusable as MillenniumFocusable } from "@steambrew/client";
import type * as Decky from "../../../node_modules/@decky/ui/dist/index";

export * from "@steambrew/client";

export const Focusable = MillenniumFocusable as unknown as typeof Decky.Focusable;
export const DropdownItem = MillenniumDropdownItem as unknown as typeof Decky.DropdownItem;

export const NavEntryPositionPreferences = {
  FIRST: 0,
  LAST: 1,
  MAINTAIN_X: 2,
  MAINTAIN_Y: 3,
  PREFERRED_CHILD: 4,
} as unknown as typeof Decky.NavEntryPositionPreferences;
export type NavEntryPositionPreferences = Decky.NavEntryPositionPreferences;

export type { ButtonItemProps, FocusableProps, GamepadEvent } from "../../../node_modules/@decky/ui/dist/index";

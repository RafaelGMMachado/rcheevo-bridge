import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getSteamCompactActionStyle, getSteamCompactAchievementFilterStyle } from "../src/platform/decky/decky-steam-compact-action-styles";
import { steamTheme } from "../src/platform/decky/steam-theme";

test("Steam compact focus changes colors without changing action geometry", () => {
  for (const tone of ["row", "primary"] as const) {
    const rest = getSteamCompactActionStyle(tone, false);
    const focus = getSteamCompactActionStyle(tone, true);
    for (const key of ["width", "minWidth", "padding", "borderRadius", "boxSizing"] as const) {
      assert.equal(rest[key], focus[key]);
    }
    assert.notEqual(rest.background, focus.background);
    assert.equal(focus.border, `1px solid ${steamTheme.focus.compactBorder}`);
    assert.equal(focus.boxShadow, steamTheme.focus.compactShadow);
  }
});

test("filter selection remains distinct from native focus and permits long counts to wrap", () => {
  const selected = getSteamCompactAchievementFilterStyle(true, false);
  const focused = getSteamCompactAchievementFilterStyle(false, true);
  const both = getSteamCompactAchievementFilterStyle(true, true);
  assert.match(String(selected.boxShadow), /inset 0 -3px/u);
  assert.doesNotMatch(String(focused.boxShadow), /inset 0 -3px/u);
  assert.match(String(both.boxShadow), /inset 0 -3px/u);
  assert.equal(selected.whiteSpace, "normal");
  assert.equal(selected.minWidth, 0);
});


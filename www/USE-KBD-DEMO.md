# use-kbd Demo Branch

This branch (`use-kbd-demo`) demonstrates how to integrate [use-kbd] into a real React application.

## Structure

Two commits on top of `main`:

1. **Remove commit** (`HEAD~1`): Strips all use-kbd integration — the inverse diff shows everything you'd need to remove
2. **Add commit** (`HEAD`): Restores from main — the forward diff shows everything needed to add use-kbd

To see what adding use-kbd looks like:

```bash
git show use-kbd-demo      # the "add" commit
git diff use-kbd-demo~1 use-kbd-demo  # same thing, as a diff
```

## What's included

- `HotkeysProvider` wrapping the app
- `useAction()` calls for metrics, time ranges, devices, aggregation, smoothing
- `ShortcutsModal` with editable keybindings and custom group renderers
- `Omnibar` (command palette) with fuzzy search
- `KbdModal` inline shortcut hints in tooltips
- `SearchTrigger` for mobile omnibar access
- `MobileSpeedDial` FAB for touch devices
- Custom styles (`_kbd.scss`, `_speed-dial.scss`)
- E2E tests for hotkey editing

## Regeneration

This branch is auto-regenerated from `main` via `/update-use-kbd-demo`.

[use-kbd]: https://github.com/runsascoded/use-kbd

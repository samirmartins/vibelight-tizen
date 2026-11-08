# Moonlight Tizen vX.Y.Z

> Unreleased draft for **VibeLight Tizen**, compared with v4.0.2.
> Version, release date and WGTs are not assigned. Samsung build/TV validation
> and publication are still pending; the visual guide is prepared locally.

## What's new

- Six clearer settings categories, compact latency/audio guidance and controller
  tuning inside the mapping editor, with selectors and sliders that fit the screen.
  Popup focus and language switching remain consistent; saved choices and
  playback defaults are preserved. Build identity and unsaved-change warnings
  make package verification and storage failures clearer.
- Per-game opt-in statistics: nine shared metric groups, ten TV-only session
  records, A/B comparison, individual deletion and technical details. Nothing is uploaded.
- One connection screen with stages and cancellation, without overlapping
  progress or dialogs; errors identify the failed stage and next action.
  Game-library refresh stays separate from restarting the app.
- Fixes pairing, persistence, native string handling and session/audio recovery,
  preventing stale launches and unsafe cleanup.
- An English-first visual guide with Portuguese/Spanish selection, illustrated
  setup and controller mapping, Normal-first package guidance and local search.

**Statistics:** enable them in the game menu for each session. Hiding the overlay
keeps recording until exit; saved records are in Settings → Diagnosis.

## Downloads

- **Normal:** standard build; recommended starting point.
- **ForceGM:** same features, with a request to enable TV panel Game Mode.

No WGT is available for this unreleased draft. The currently published packages
remain [v4.0.2](https://github.com/samirmartins/vibelight-tizen/releases/tag/v4.0.2).

## Installation

Follow the [Installation Guide](https://github.com/samirmartins/vibelight-tizen/blob/master/INSTALLATION.md).
Reuse your signing profile/author certificate when updating; uninstalling can
erase pairing, settings and local records. The visual guide is available as local
[English](docs/index.html#install), [Português (Brasil)](docs/pt-br/index.html#install)
and [Español](docs/es/index.html#install) HTML sources until Pages is activated.

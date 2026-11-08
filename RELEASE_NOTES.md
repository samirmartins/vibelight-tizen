# Moonlight Tizen vX.Y.Z

> Unreleased draft for **VibeLight Tizen**, compared with v4.0.2.
> Version, release date and WGTs are not assigned. Samsung build/TV validation
> and publication are still pending; the visual guide is prepared locally.

## What's new

- Six clearer settings categories, compact latency/audio guidance and a direct
  controller-tuning shortcut, with selectors and sliders that fit the screen.
  Saved choices and playback defaults are preserved.
- Per-game opt-in statistics: nine shared metric groups, ten TV-only session
  records, A/B comparison and technical details. Nothing is uploaded.
- Connection stages and cancellation, with game-library refresh separate from
  restarting the app.
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

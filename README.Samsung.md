# Samsung Tizen notes

VibeLight Tizen is a fork of Moonlight Tizen, which adapts Moonlight Chrome to Samsung TVs through WebAssembly. Its main platform layer is under `wasm/` and uses Samsung's [Tizen WASM Player](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/tizen-wasm-player/overview.html) and [Sockets Extension](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/api-reference/tizen-sockets-extension.html).

Dependencies are vendored in this repository; no Git submodule initialization is required.

- To install or update a release, see the [Installation Guide](INSTALLATION.md).
- For illustrated setup and settings, see the online
  [English](https://samirmartins.github.io/vibelight-tizen/?lang=en#install),
  [Português (Brasil)](https://samirmartins.github.io/vibelight-tizen/pt-br/?lang=pt-br#install) or
  [Español](https://samirmartins.github.io/vibelight-tizen/es/?lang=es#install) guide.
- To build locally, use the [compilation and packaging guide](build-tools/README.md#local-compilation-and-packaging),
  including the two-stage recipes and signing identity requirements.
- For regression checks and dependencies, use [Tests and GitHub Actions](build-tools/README.md#tests-and-github-actions).
- For the changes in each release, see the [changelog](CHANGELOG.md) and the
  [release notes](RELEASE_NOTES.md) of the latest one.

Widget, application and package IDs are installation compatibility identifiers.
Documentation/branding updates do not rename them. Preserve those IDs and the
author identity for updates; build WASM and JavaScript from the same source.

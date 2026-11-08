# Contributing

Issues and focused pull requests are welcome.

## Issues

Use the [issue templates](https://github.com/samirmartins/vibelight-tizen/issues/new/choose).
Include app/TV/Tizen versions, installation method and reproduction steps.
Include the VibeShine/Sunshine version when relevant. For playback issues, an
optional local diagnosis image can help: enable Statistics in that game, leave
the session, then open Settings → Diagnosis. Sharing it is manual; the app does
not upload statistics. Sessions never activated have no diagnosis to attach.
Mask private addresses and identifiers; never attach credentials, pairing/input
keys, private certificates or unredacted logs.

## Development

For runtime changes, run from the repository root:

```bash
bash build-tools/run-tests.sh
```

See the [build guide](../build-tools/README.md) for dependencies, baseline tags,
Samsung compilation, Normal/ForceGM and local signing. Dependencies are vendored;
no submodule initialization is required.
Documentation-only changes need content/link checks, not a build or TV test.
Report tests actually run and any remaining hardware validation.

## Documentation and release summaries

The [visual guide](../docs/index.html) is prepared for Pages, with English as the
first-visit default and explicit PT-BR/ES selection. HTML links show source on
GitHub until hosting is active; the [Installation Guide](../INSTALLATION.md)
remains readable there.

For guide edits, update the same topics in `docs/_source/en.json`, `pt-br.json`
and `es.json`, regenerate the HTML and check it:

```bash
node build-tools/build-docs.cjs
node build-tools/build-docs.cjs --check
node build-tools/docs-test.cjs
```

Check content/links for Markdown-only edits. Verify affected language, search,
keyboard and mobile flows when changing website behavior. See the
[authoring notes](../build-tools/README.md#edit-the-trilingual-guide).

Keep new work in [Unreleased](../CHANGELOG.md#unreleased) and summarize it in
[RELEASE_NOTES.md](../RELEASE_NOTES.md). Preserve published history, distinguish
source features from available WGTs and leave an unassigned version as a draft.

## Pull requests

- Keep one fix/feature per PR and avoid unrelated refactoring.
- Explain the reason, user-visible effects, tests and known limitations.
- Document dependency changes and the relevant upstream source.
- Keep private information out of source, screenshots, logs and commit metadata.

By participating, you agree to the [Code of Conduct](../CODE_OF_CONDUCT.md).

# Build tools

Regression checks, development builds and release signing. A recipe being here
does not prove a completed end-to-end build or an update-compatible package.

## Tests and GitHub Actions

From the repository root:

```bash
bash build-tools/run-tests.sh
```

It runs every `wasm/*_test.js` (several compile native fixtures with ASan/UBSan)
and six standalone C++ tests, plus the documentation checks. Needs Node.js 22,
GCC/G++, FFmpeg with libx264, OpenSSL headers, Git and GNU timeout. The runner
bounds each process, rejects unhandled rejections and cleans up temporary files.

- **x86 and ARM.** On ARM kernels with a 39-bit address space (e.g. Raspberry Pi
  OS) it switches to GCC 12 with static ASan; time limits are 4× longer
  (`ML_TEST_TIMEOUT_SCALE=<1-100>` overrides). Packages:
  `sudo apt install build-essential ffmpeg libssl-dev gcc-12 g++-12`.
  If Git reports dubious ownership, run the `safe.directory` command it prints.
- **Full history.** Some tests compare against earlier releases, so use a full
  checkout with tags. CI uses `fetch-depth: 0`, read-only permissions and no
  signing secrets (`release_security_test.js` enforces this).
- **Source freeze.** `scope_contract_test.js` checks native code, vendored
  protocol/codec libraries, `CMakeLists.txt` and gameplay JavaScript against
  `wasm/frozen-sources.json`. After an approved, tested change to one of them, run
  `node build-tools/frozen-sources.cjs --update` and commit the manifest in the
  same commit, never to silence an unexplained failure. Menus are covered by
  behavioral tests instead.
- **Fixtures.** Shared setup lives in `wasm/fixtures/`; a test never imports
  another test file (`test_runner_test.js` enforces it).

What the suite covers, by area (one `*_test.js` per topic): RTP transport and
video recovery, display cadence, frame pacing, session and app lifecycle, Smart
Hub visibility, host quit and app switching, controller mapping, menu navigation,
controller test mode, rumble, gamepad publication, audio telemetry and overflow
recovery, overlay and diagnostics, library selection, pairing, mouse capture,
guide/help and menu dialogs. These are synthetic or fixture-based: they do not
compile the Samsung target or measure TV latency, fluency or stability.

Optional stress, outside the core run:

- `ML_STARTUP_CASES`, `ML_RUMBLE_FRAMES`, `ML_AUDIO_SECONDS`,
  `ML_LIFECYCLE_CYCLES`, `ML_STRESS_SEED` enlarge the existing fixtures.
- `ML_LIFECYCLE_SANITIZER=thread` and `ML_PACING_SANITIZER=thread` run race checks.
- `protocol_fuzz_test.js` mutates the real RTSP/SPS parsers (400 cases each, skipped
  by default on ARM); `ML_FUZZ_CASES`, `ML_FUZZ_TARGETS`, `ML_FUZZ_REPLAY` and
  `ML_FUZZ_CASE_DIR` tune it. Passing fuzz is bounded evidence, not proof.
- `ML_NATIVE_SANITIZERS=undefined` for new native drivers where ASan cannot start.

Documentation-only changes need content and link checks, not a WGT build or TV test.

## Local compilation and packaging

Release builds use a two-stage local path. The Tizen installer needs
`nofile=1024:524288`, or its bundled JVM may fail and later report a misleading
`tizen: not found`.

```bash
docker build -f build-tools/Dockerfile.buildonly -t moonlight-wasm-check .
docker build --ulimit nofile=1024:524288 \
  -f build-tools/Dockerfile.package -t moonlight-wgt .
```

The root `Dockerfile` (`docker build --ulimit nofile=1024:524288 -t moonlight-tizen .`)
is an alternative whose full run has not been established. Compiling alone
validates neither packaging nor TV playback. Always ship WASM and JavaScript from
the same build: they share an 18-word audio control block.

Extract the WGT with `docker create` and `docker cp` from
`/home/moonlight/VibeLight-v<version>-samirmartins[-ForceGM].wgt`, then remove
that temporary container.

### Signing identity

Without a persistent author key, generic recipes create a **test certificate**,
which can block installing over a previous version. For releases, keep the
existing author identity and application/package IDs, and pass the private key
only through **local** BuildKit secret mounts (never the source tree, image
layers, logs or remote runners), with its `SIGNING_CERT_SHA256` pin. Never
re-sign a published widget or silently generate a replacement key.

### Embind string protection

Packaging recipes patch `build/widget/moonlight-wasm.js` before signing with
`patch-embind-string.cjs`, which replaces exactly one known Samsung converter and
fails on missing, repeated or already patched input. Never patch a signed archive.

```bash
node wasm/embind_string_test.js
node wasm/embind_string_test.js --baseline   # expected nonzero exit
node wasm/embind_string_test.js --artifact /path/to/moonlight-wasm.js
python3 build-tools/verify-embind-wgt.py /path/to/candidate.wgt
```

## ForceGM

Same code as Normal; ForceGM only adds the panel Game Mode request to `config.xml`:

```xml
<tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>
```

```bash
docker build --ulimit nofile=1024:524288 --build-arg FORCE_GAME_MODE=1 \
  -f build-tools/Dockerfile.package -t moonlight-wgt-forcegm .
```

It is independent of the in-app **Ultra-low video latency** switch, which defaults
off (also with ForceGM) and can be unstable on some TVs. Both variants share IDs;
updating without losing settings also needs a compatible author identity.

## Widget checks

```bash
python3 build-tools/verify-widgets.py \
  VibeLight-v<version>-samirmartins.wgt \
  VibeLight-v<version>-samirmartins-ForceGM.wgt \
  --author-cert /path/to/public-author.der
```

Checks version/IDs, public author identity, ForceGM metadata and variant payload
equality. It does not replace signature coverage checks, a privacy review or a
TV installation test.

## Release signing

Signing is local only; CI only tests. Never upload private certificates to GitHub
Secrets or remote builders. Upload only audited WGTs and notes after explicit
authorization; a draft or tag also needs approval.

Notes: `Dockerfile.package` keeps an extra JDK from its validated recipe.
`__BUILD_TYPE__` / `__BUILD_COMMIT__` are filled in by CI; without them System
Info shows Build: Unavailable.

## Documentation

[CHANGELOG.md](../CHANGELOG.md#v405) and [RELEASE_NOTES.md](../RELEASE_NOTES.md)
describe v4.0.5. The online [visual guide](https://samirmartins.github.io/vibelight-tizen/)
covers the same release. Keep published changelog sections intact. `metadata.published` in
`build-docs.cjs` is the single published version: `docs-test.cjs` requires
README, INSTALLATION, this section, RELEASE_NOTES, the CHANGELOG and the site to
name it, lets `res/config.xml` be a newer candidate, requires CMake to follow
`res/config.xml` and checks every relative link and anchor offline.

The guide QR is the committed `wasm/static/res/guide-qr.svg`. To change its
destination, regenerate it with `python3 build-tools/generate-guide-qr.py`
(needs libqrencode; `--check` verifies) and publish the destination before release.

### Edit the trilingual guide

Content lives in `docs/_source/en.json`, `pt-br.json` and `es.json`; change the
same topic IDs in all three and keep the release and review date in
`build-tools/build-docs.cjs` accurate. With Node.js 18+:

```sh
node build-tools/build-docs.cjs
node build-tools/build-docs.cjs --check
node build-tools/docs-test.cjs
```

Commit the generated `docs/index.html`, `docs/pt-br/index.html` and
`docs/es/index.html` with their assets; GitHub Pages serves them as is (keep
`.nojekyll`). Text accepts `[label](https://…)` and `[label](#topic-id)` links;
raw HTML is not supported. English is the default regardless of browser language;
an explicit choice is remembered locally. Search runs only in the browser. Check
changes in all three languages, on mobile and desktop and with the keyboard.

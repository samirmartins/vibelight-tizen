# Build tools

This guide separates regression checks, development builds and release signing.
The public recipes remain available; their presence is not proof of a completed
end-to-end build or compatibility with an existing installation.

## Tests and GitHub Actions

From the repository root:

```bash
bash build-tools/run-tests.sh
```

Runs every `wasm/*_test.js` and six standalone C++ tests: audio ring, concurrent
PCM stress, dispatcher, video timing, telemetry and mocked Wake-on-LAN.
The JavaScript entries also compile native fixtures for RTSP/Opus, input focus,
codec setup, decoder errors, session teardown, certificates and H.264 pixel equality.
Historical source-identity checks are consolidated in `scope_contract_test.js`;
they enforce approved scope, not performance. Baselines must not be refreshed
silently to make a failing test pass.
Dependencies: Node.js 22, GCC/G++, FFmpeg with libx264, OpenSSL development headers
and Git/GNU timeout. Native fixtures use ASan/UBSan.
The runner checks completion markers, rejects unhandled rejections, bounds each
process and cleans temporary files, including failed runs.
Source comparisons reference historical tags and reviewed commit checkpoints;
use a full checkout and preserve that history. CI uses `fetch-depth: 0` and read-only permissions, without
signing secrets. These tests do not compile the Samsung target or prove TV performance.

Transport recovery: `video_transport_test.js` compares real RTP/depacketizer
code with v3.4.9 under reordering, real loss and partial traffic for three codecs.
It checks deferred IDR spacing, cancellation, bounded logs, recovery transitions,
and healthy payload/timestamps/clock reads. `display_cadence_test.js` preserves
11 reliable rates and rejects mixed cadence without touching presentation.
Exact source guards and negative controls complement behavioral tests; synthetic
clock/packets and fake decoder results do not measure physical latency or fluency.
`release_security_test.js` keeps private signing out of workflows and CI read-only.

Session lifecycle: the core compiles production methods with real pthreads and a
controllable platform adapter. It covers concurrent duplicate stops, absent/failed
Open/Close callbacks, thread-creation failure, retained resource ownership, delayed
completion, stale workers/listeners and reopening. The `--strict` entry point is
retained; these safety contracts are now included in the default test.
For a separate race check, set `ML_LIFECYCLE_SANITIZER=thread`.
These fixtures do not emulate the full Samsung runtime or prove TV stability.

Smart Hub: the approved policy disconnects only the client on visibility loss;
the host game stays open and the user resumes manually from the library.
`app_lifecycle_test.js` covers repeated hide/show, cancelled menu/WoL work,
delayed launch/resume replies, stale connection messages and preserved launch
payloads. `input_focus_test.js` checks held-input release before disconnect;
blur alone does not stop a stream. Hardware suspension/EMSS still needs a TV test.

Host quit and app switching: `host_quit_test.js` exercises a single 15-second
budget for the quit request and authenticated host-closure confirmation, per-request
native cancellation, refusal, a stalled host, late replies and callback/timer cleanup.
Only an explicit user quit starts temporary status checks; the quit command is
sent once. The stream overlay keeps local Disconnect available; disconnecting
cannot undo a quit already received by the PC. `session_transition_test.js` covers
manual and confirmed close-and-start launches, event-driven native cleanup,
supersession, Smart Hub cancellation and bounded missing completion. It replaces
the fixed three-second switch delay, preserving launch/resume parameters and
media/input algorithms. Existing native teardown safety remains in force; no
forced release occurs after a decoder-close failure. Mock transport/platform
fixtures do not establish Samsung HTTP/decoder behavior or physical latency.

Extended native HTTP/RTP, browser layout/navigation and actual WGT signature/privacy
checks are coordinated by the maintainer's local tools, separately from public CI.
Browser/EMSS adapters are not a Samsung decoder or a physical controller.

Optional controller mapping: `controller_mapping_test.js` checks permutation
validation, persistence/failure, exact trigger bits, multi-controller snapshots
and the original function identity when OFF. The editor/test loop is menu-only;
sticks, rumble and native streaming algorithms are unchanged. Historical source
guards allow only the explicit integration points, not arbitrary input changes.

Optional audio telemetry: `audio_telemetry_test.js` compares Worklet/fallback
Float32 output and drift control with v3.4.3 across rates/channels and ON/OFF
transitions. OFF skips depth extrema; functional adaptation remains active.
Source contracts allow only collection gates, not audio/video retuning.

Gamepad publication: `gamepad_publication_test.js` compares exact shared words
with v3.4.3, counts atomic stores and checks sequence wrap, hotplug, stop/restart
and a contending reader worker. Only changed payload words are stored; initial
publication and stop still overwrite the full payload. Sampling, mapping,
notification and native seqlock behavior stay unchanged. This is not TV timing.

Overlay aggregation: `overlay_aggregation_test.js` compiles the production
collection prefix and both formatters with deterministic adapters and ASan/UBSan.
It compares messages/history with v3.4.3 across codecs, rates and independent
consumer transitions. Diagnostic-only collection skips display aggregation;
window cadence and overlay reactivation remain unchanged. The current opt-in
payload appends frame load, packet count, zero-copy and cadence deviation fields;
legacy fields/history and native playback remain covered by equality checks.

Library selection: `library_selection_test.js` compares the complete selected-card
state with the prior implementation and counts writes/mutations. It covers
immediate focus persistence, restart, legacy/corrupt storage, quota failures,
multiple PCs, filters, launch and suspension. Compact focus is merged before
opening a PC and retired only after a successful full-preferences write.

Menu controller: `controller_menu_test.js` compares events, order and private
snapshots with the prior implementation, including hotplug, layout changes,
restart, legacy polling and synchronous/reentrant listeners. Stable layouts
reuse snapshot arrays/buttons; unchanged polls do not create a changes array.
Emitted payloads remain independent; menu events also identify their controller.
The 16 ms interval and all streaming and
rumble policy remain frozen; allocation counts are not physical TV measurements.

Menu navigation: `library_navigation_test.js` executes the production reader,
listener and navigation stack against v3.4.8 with a deterministic clock. It covers immediate
analog selection, jitter/hysteresis, digital repeat, direction reversal, multiple
controllers, cancellation and unchanged gameplay sources. Library, Settings, PC
selection and pairing dialogs share this state. View changes cancel held-input
repetition; the controller test captures raw input independently. Synthetic
timing is not physical controller-to-screen latency.

Controller test mode: `controller_test_mode_test.js` checks physical artwork
highlights, confirm/back isolation, a continuous three-second Circle/B hold,
release protection, hotplug and cleanup. `rumble_work_test.js` compares exact
actuator traces with v3.4.4 and counts shared reads for zero to four controllers;
only inactive-slot work changes. These checks do not measure TV latency or CPU.

For documentation-only changes, check content, links and templates; a TV test
or WGT rebuild is not required. For runtime changes, select the full suite and
focused native/browser checks appropriate to the affected behavior.

Video recovery: `video_recovery_test.js` compares the production RTP queue,
depacketizer and extracted submit/status code against v3.4.7 using synthetic
codec headers, a controlled clock and injected Samsung results. It checks
repeated rejected keyframes, deferred IDR requests without another submit,
500 ms spacing, wrap/zero, cancellation/restart and healthy payload/timestamp/
clock-read equivalence. ASan/UBSan and a negative control guard the fixture.
The idle retry uses the existing receive timeout; no video queue or worker is
added. These are recovery contracts, not measured FPS or TV latency gains.

Configurable frame pacing: `frame_pacing_test.js` exercises the optional scheduler
and real common-c RTP/depacketizer/queue with ASan/UBSan. It covers quantized
arrivals, bounded requested waits, timer bypass, IDR acknowledgement/cooldown,
stale references, overflow, allocation failure, oversized frames, concurrent
receive/complete, cancellation and ON defaults shared by Play/Resume, preserving
explicit saved OFF preferences and checking Restore defaults and the menu label.
Use `ML_PACING_SANITIZER=thread node wasm/frame_pacing_test.js` for its separate
race check. ON alone selects the existing decoder worker; OFF keeps direct
submission without a pacing context or wait. Synthetic scheduling and mock
submission do not establish Samsung presentation timing, latency or A/V sync.

Optional seeded stress is separate from the core runner. The existing JS fixtures
accept `ML_STARTUP_CASES`, `ML_RUMBLE_FRAMES`, `ML_AUDIO_SECONDS`,
`ML_LIFECYCLE_CYCLES` and `ML_STRESS_SEED`; defaults keep the normal core bounded.
`protocol-fuzz.cpp` is an optional ASan/UBSan driver for the real RTSP/SPS parsers,
not linked into the application. The maintainer's local coordinator builds it,
supplies bounded synthetic seeds, preserves failing inputs and runs TSan separately.
The reproduced duplicate-RTSP-header leak, truncated-header out-of-bounds read
and H.264 Exp-Golomb/array-bound failures are covered by defensive repairs and
regression tests. Valid SPS decoding preserves pixels, profile, level and references.
Fuzz success is bounded input evidence, not proof against every malformed stream.

## Correction regression coverage

The review correction tests exercise the production pairing handshake with a
local synthetic peer (SHA-1/SHA-256, malformed fields, allocation failures and
challenge authentication), empty HTTP responses, synchronized stop notification,
launch/quit identity, cancellation and storage recovery. Native tests use
ASan/UBSan by default. The new native fixture drivers also accept
`ML_NATIVE_SANITIZERS=undefined` for environments where ASan cannot initialize;
that does not change the sanitizer flags in other existing fixtures.

Audio overflow recovery requires a consumer ACK before the producer can reuse
PCM. A consumer gate protects callbacks during retirement and backend changes.
The shared control block is now 18 words: indexes 0–14 are preserved, 15 is the
reset position, 16 the ACK and 17 the ownership/retirement gate. Deploy WASM and
JavaScript from the same build. Healthy PCM, adaptation and servo behavior are
compared against the published baseline. Timeout/retirement tests compile the
production feeder and cleanup with synthetic Opus and browser adapters; they do
not establish Samsung runtime compatibility or physical playback quality.

## Local compilation and packaging

The release builds recorded for this fork used a two-stage local path.
The Tizen installer needs `nofile=1024:524288`: an older bundled JVM may otherwise
fail to allocate its descriptor table and leave the CLI uninstalled, producing
a misleading `tizen: not found` later.

Development recipes:

```bash
docker build -f build-tools/Dockerfile.buildonly -t moonlight-wasm-check .
docker build --ulimit nofile=1024:524288 \
  -f build-tools/Dockerfile.package -t moonlight-wgt .
```

Compilation alone validates neither packaging nor TV playback. The public root
Dockerfile remains an alternative recipe, but its complete end-to-end execution
has not been established by those two-stage builds:

```bash
docker build --ulimit nofile=1024:524288 -t moonlight-tizen .
```

### Signing identity

Generic Docker recipes can generate a **test certificate** when no persistent
author key is supplied. A test key is not the release identity and can prevent
installation over a previous version.

For release builds, preserve the existing author identity and application/package
IDs. Supply the private key separately through **local** BuildKit secret mounts,
not through the source tree, image layers, logs or a remote runner. The public
author certificate may be used for identity verification; it is not the private key.
Recipes using a persistent key also require its SIGNING_CERT_SHA256 identity pin.
Do not silently generate a replacement or re-sign an already published widget.

Extract the WGT from the packaging image with `docker create` and `docker cp`.
The path is `/home/moonlight/VibeLight-v<version>-samirmartins[-ForceGM].wgt`;
substitute the version in `res/config.xml` and omit `-ForceGM` for Normal.
Remove only the temporary container created for extraction.

### Embind string protection

The root, two-stage and maintainer's local packaging recipes patch the installed
`build/widget/moonlight-wasm.js` before signing. The build-only image retains
the original compiler output. `patch-embind-string.cjs` replaces exactly one
known Samsung converter, preserves embedded NUL characters and uses bounded
UTF-8 reads without temporary heap writes. Missing, repeated or already patched
input fails instead of silently changing the toolchain contract.

The behavioral fixture is extracted from the 4.0.2 package. Run:

```bash
node wasm/embind_string_test.js
# Expected nonzero exit: demonstrate the transient out-of-bounds write.
node wasm/embind_string_test.js --baseline
# Optional: test against a generated, unpatched module from the actual build.
node wasm/embind_string_test.js --artifact /path/to/moonlight-wasm.js
python3 build-tools/verify-embind-wgt.py /path/to/candidate.wgt
```

The WGT checker requires Python 3 and Node, rejects duplicate ZIP members, and
checks the actual root `moonlight-wasm.js`, using the same canonical verifier.
It does not verify signatures or demonstrate Samsung playback. The maintainer's
local builder calls it after extracting each signed WGT. Do not apply the patch
to an already signed archive; regenerate and sign a new candidate instead.

## ForceGM

Both variants use the same code. ForceGM adds this panel request to `config.xml`:

```xml
<tizen:metadata key="http://samsung.com/tv/metadata/use.game.mode" value="true"/>
```

It is independent of the in-app **Ultra-low video latency** switch (`kUltraLow`,
called Game Mode in v4.0.2). That switch defaults **off**, including with ForceGM,
and can be unstable on some TVs/system versions. On the previously tested
Tizen 9 configuration, leave it off; ForceGM still requests panel Game Mode.
This does not establish identical behavior on every TV.

```bash
docker build --ulimit nofile=1024:524288 --build-arg FORCE_GAME_MODE=1 \
  -f build-tools/Dockerfile.package -t moonlight-wgt-forcegm .
```

The root recipe accepts the same argument. Normal/ForceGM share application/package
IDs; updating without losing settings also requires a compatible author identity
and installation/re-signing method.

## Widget checks

Export the expected **public** author certificate as DER and set WIDGET_VERSION
to the actual candidate's metadata. This example uses the current 4.0.2 metadata,
not an announcement of a new release:

```bash
WIDGET_VERSION=4.0.2
python3 build-tools/verify-widgets.py \
  "VibeLight-v${WIDGET_VERSION}-samirmartins.wgt" \
  "VibeLight-v${WIDGET_VERSION}-samirmartins-ForceGM.wgt" \
  --author-cert /path/to/public-author.der
```

This checks version/IDs, public author identity, ForceGM metadata and variant
payload equality. It does not replace cryptographic signature/digest coverage
verification, privacy review or a TV installation test.

## Release signing

Signing is local only. Remote packaging/signing workflows are removed; the
read-only test CI remains available. Never upload private certificates to GitHub
Secrets or remote builders. Upload only audited WGTs/notes after explicit
authorization; a draft or tag also requires approval.

## Recipe-specific notes

- `Dockerfile.package` retains an extra JDK from its validated recipe; the Tizen
  installer also bundles one. Removing it has not been tested.
- `__BUILD_TYPE__` / `__BUILD_COMMIT__` are substituted by CI. A local path that
  does not inject valid metadata shows Build: Unavailable in System Info. Check
  the actual artifact; valid build identifiers are shown alongside version/variant.

## Local session diagnostics and settings

Guide and help uses the committed `wasm/static/res/guide-qr.svg`; builds require
no QR service or encoder. To change its permanent destination, update the readable
address and regenerate with `python3 build-tools/generate-guide-qr.py` (authoring
dependency: libqrencode). `--check` verifies reproducibility. The asset includes
four-module quiet zones and Q error correction. `guide_help_test.js` covers
menu ownership, guards and the bundled address; independently decode rendered
screenshots when changing the asset. Publish and verify the Pages destination
before release; generating the QR does not publish the guide.

Activation is session-local and explicit in the in-game overlay. Hidden statistics
continue recording until that session ends; a new session is inactive regardless
of legacy preferences. One diagnostics observer feeds the nine overlay groups and
a local summary. No statistics are uploaded.

`diagnostic_history_test.js` covers the ten-record limit, idempotent migration,
failed/corrupt storage preservation, individual deletion (including migrated
records and empty history), missing metrics, normalized event rates and
A/B selection. `diagnostic_session_test.js`, `diagnostics_test.js` and
`performance_overlay_test.js` exercise production activation, bounded long
sessions, generations, partial coverage, coalesced callbacks and observer reuse.
`diagnostic_view_test.js` checks saved configuration visibility, A/B values,
return focus and offline consultation. Native-event rates use native measurement
coverage; audio/browser/event rates use their recording interval.
`menu_feedback_test.js` checks failed preference writes and build metadata;
`menu_dialogs_test.js` checks cancel/close ownership and restoration of focus,
including delayed native close events and rapid reopening.
`stream_startup_test.js` and `library_refresh_test.js` cover cancellation ownership
and list updates without restarting the app. `experience_scope_test.js` verifies
the exact approved delta with negative controls and freezes native playback,
audio and input outside the opt-in payload formatter.

The static documentation is in `docs/` (GitHub Pages, no build or remote services).
It describes current source; publishing it and new WGTs are separate actions.
Browser/fixture results are not Samsung SDK compilation or physical TV evidence.

New work is recorded in [Unreleased](../CHANGELOG.md#unreleased); the next release
summary is [RELEASE_NOTES.md](../RELEASE_NOTES.md), kept as a draft until a version
is assigned. These are source changes, not a replacement of the published 4.0.2
WGTs. Keep published changelog sections intact and update the guide's common
release metadata only when the corresponding release is actually available.

### Edit the trilingual guide

Content lives in `docs/_source/en.json`, `pt-br.json` and `es.json`. Update the
same topic IDs in all three files; keep the published release and review date in
`build-tools/build-docs.cjs` accurate. The guide distinguishes published packages
from upcoming source features. Use Node.js 18+ for local authoring:

```sh
node build-tools/build-docs.cjs
node build-tools/build-docs.cjs --check
node build-tools/docs-test.cjs
```

Commit the generated `docs/index.html`, `docs/pt-br/index.html` and
`docs/es/index.html` with their content/assets. GitHub Pages serves them directly;
it does not run Node or require npm dependencies. Keep `.nojekyll`.

Paragraphs, steps and callouts accept inline `[label](https://example.com)` or
`[label](#topic-id)` links. Other text stays escaped; raw HTML is not supported.
Link tools to their official projects and use topic links for related answers.

English is the first-visit default, independent of browser language. Explicit
language selection marks the destination URL and remembers the choice locally;
it keeps the topic even when storage is stale or read-only. Search matches individual answers, ignores accents,
shows excerpts and stays entirely in the browser. Legacy Portuguese anchors
remain supported. Validate the site under a repository subpath, on mobile and
desktop, with keyboard navigation and all three languages. Documentation-only
changes do not need a WGT build or the native gameplay suite.

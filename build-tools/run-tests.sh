#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
for command in node gcc g++ ffmpeg git timeout; do
  command -v "$command" >/dev/null || { echo "Missing dependency: $command" >&2; exit 1; }
done
git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "Git cannot read this checkout. If it reports dubious ownership (for example a" >&2
  echo "synchronized folder owned by another user), run once:" >&2
  echo "  git config --global --add safe.directory $PWD" >&2
  exit 1
}
# Earlier releases and checkpoints compared by behavioral tests (kept in sync by
# test_runner_test.js).
for reference in v3.3.10 v3.4.3 v3.4.4 v3.4.7 v3.4.8 v3.4.9 0b77114 6fe39d2 7b08c77 97c158e a434117 daca400 df6eb63; do
  git rev-parse --verify "$reference^{commit}" >/dev/null 2>&1 || {
    echo "Missing history reference $reference. Fetch the full history and tags." >&2; exit 1;
  }
done
encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null)
[[ "$encoders" == *libx264* ]] || { echo 'FFmpeg libx264 encoder missing' >&2; exit 1; }
printf '#include <openssl/ssl.h>\n' | g++ -x c++ - -fsyntax-only 2>/dev/null || {
  echo 'Missing OpenSSL development headers: install libssl-dev' >&2; exit 1;
}
test_directory=$(mktemp -d)
trap 'rm -rf "$test_directory"' EXIT
# Same compiler on x86; on ARM kernels whose default ASan runtime cannot start,
# wrappers select GCC 12 with its static ASan runtime (see native-toolchain.cjs).
toolchain=$(TMPDIR="$test_directory" node build-tools/native-toolchain.cjs "$test_directory/toolchain")
[[ -z "$toolchain" ]] || export PATH="$toolchain:$PATH"
# Limits are calibrated on x86 and scaled 4x on ARM (ML_TEST_TIMEOUT_SCALE overrides).
scale=$(node build-tools/native-toolchain.cjs --timeout-scale)
export TMPDIR="$test_directory"
export ASAN_OPTIONS=detect_leaks=1
export UBSAN_OPTIONS=halt_on_error=1
for test in wasm/*_test.js; do
  echo "Running $test"
  ML_TEST_NAME="$(basename "$test" .js)" timeout --kill-after=5s "$((120 * scale))s" \
    node --unhandled-rejections=strict --require ./build-tools/test-process.cjs "$test"
done
for test in audio_ring audio_ring_stress dispatcher video_timing video_telemetry wakeonlan; do
  echo "Running ${test}_test.cpp"
  timeout --kill-after=5s "$((90 * scale))s" g++ -std=c++17 -O1 -g \
    -fsanitize=address,undefined -fno-omit-frame-pointer -pthread -Iwasm \
    "wasm/${test}_test.cpp" -o "$test_directory/$test"
  timeout --kill-after=5s "$((30 * scale))s" "$test_directory/$test"
done
# Documentation: three-language site, release versions and Markdown links, then
# the generated pages must be reproducible from docs/_source.
echo 'Running build-tools/docs-test.cjs'
ML_TEST_NAME=docs-test timeout --kill-after=5s "$((60 * scale))s" \
  node --unhandled-rejections=strict --require ./build-tools/test-process.cjs build-tools/docs-test.cjs
echo 'Running build-tools/build-docs.cjs --check'
timeout --kill-after=5s "$((60 * scale))s" node build-tools/build-docs.cjs --check
echo 'All core behavioral, scope-contract and documentation tests passed; TV and extended checks are separate.'

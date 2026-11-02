#!/bin/bash
# Build binaries for all supported platforms.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$PROJECT_ROOT/bin"

mkdir -p "$BIN_DIR"
cd "$PROJECT_ROOT"

platforms=(
    "darwin/arm64"
    "darwin/amd64"
    "linux/amd64"
    "linux/arm64"
    "windows/amd64"
)

for platform in "${platforms[@]}"; do
    GOOS="${platform%/*}"
    GOARCH="${platform#*/}"
    output="$BIN_DIR/opencode-discord-status-${GOOS}-${GOARCH}"
    if [[ "$GOOS" == "windows" ]]; then
        output="${output}.exe"
    fi

    echo "  building ${GOOS}/${GOARCH}"
    CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
        go build -trimpath -ldflags="-s -w" -o "$output" .
done

echo "Built:"
ls -lh "$BIN_DIR"

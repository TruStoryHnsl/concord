#!/bin/bash
# build-ios.sh — Build Concord for iOS and serve via AltStore source
#
# Usage:
#   ./scripts/build-ios.sh           # Build .ipa only
#   ./scripts/build-ios.sh serve     # Build + start local HTTP server
#   ./scripts/build-ios.sh serve-only # Start server (skip build)
#
# After "serve", add this source in AltStore on your iPhone/iPad:
#   http://<this-mac-ip>:8443/source.json

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPLE_DIR="$ROOT/src-tauri/gen/apple"
DIST_DIR="$ROOT/dist/altstore"
PORT=8443

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }

build_rust() {
    bold "==> Building Rust library for aarch64-apple-ios (release)..."
    cd "$ROOT"
    cargo build \
        --package concord-app \
        --manifest-path src-tauri/Cargo.toml \
        --target aarch64-apple-ios \
        --release \
        --lib

    mkdir -p "$APPLE_DIR/Externals/arm64/release"
    cp "$ROOT/target/aarch64-apple-ios/release/libconcord_app.a" \
       "$APPLE_DIR/Externals/arm64/release/libapp.a"
    green "    Rust library built"
}

build_frontend() {
    bold "==> Building frontend..."
    cd "$ROOT/frontend"
    npm run build
    mkdir -p "$APPLE_DIR/assets"
    cp -r dist/* "$APPLE_DIR/assets/"
    green "    Frontend built"
}

build_xcode() {
    bold "==> Building Xcode project (unsigned)..."
    cd "$APPLE_DIR"

    # Regenerate project from project.yml
    xcodegen generate 2>/dev/null

    # Clean previous build
    rm -rf build/derived build/ipa build/Concord.ipa
    rm -f Externals/arm64/debug/libapp.a 2>/dev/null || true

    xcodebuild \
        -scheme concord-app_iOS \
        -workspace concord-app.xcodeproj/project.xcworkspace/ \
        -sdk iphoneos \
        -configuration release \
        -derivedDataPath build/derived \
        CODE_SIGNING_ALLOWED=NO \
        CODE_SIGN_IDENTITY="" \
        CODE_SIGNING_REQUIRED=NO \
        -quiet

    green "    Xcode build succeeded"
}

package_ipa() {
    bold "==> Packaging .ipa..."
    cd "$APPLE_DIR"
    mkdir -p build/ipa/Payload
    cp -r build/derived/Build/Products/release-iphoneos/Concord.app build/ipa/Payload/
    cd build/ipa
    zip -qr ../Concord.ipa Payload/

    # Copy to dist
    mkdir -p "$DIST_DIR"
    cp ../Concord.ipa "$DIST_DIR/Concord.ipa"

    local SIZE
    SIZE=$(stat -f%z "$DIST_DIR/Concord.ipa")
    green "    .ipa packaged: $(du -h "$DIST_DIR/Concord.ipa" | cut -f1) ($SIZE bytes)"

    # Update size in source.json
    if [ -f "$DIST_DIR/source.json" ]; then
        sed -i '' "s/\"size\": [0-9]*/\"size\": $SIZE/" "$DIST_DIR/source.json"
    fi
}

update_source_urls() {
    local IP
    IP=$(ipconfig getifaddr en0 2>/dev/null || echo "192.168.1.132")

    if [ -f "$DIST_DIR/source.json" ]; then
        sed -i '' "s|http://HOST:$PORT|http://$IP:$PORT|g" "$DIST_DIR/source.json"
        sed -i '' "s|http://[0-9.]*:$PORT|http://$IP:$PORT|g" "$DIST_DIR/source.json"
    fi
}

serve() {
    local IP
    IP=$(ipconfig getifaddr en0 2>/dev/null || echo "192.168.1.132")

    update_source_urls

    bold ""
    bold "=========================================="
    bold "  Concord AltStore Source"
    bold "=========================================="
    echo ""
    echo "  Add this source in AltStore:"
    echo ""
    bold "  http://$IP:$PORT/source.json"
    echo ""
    echo "  Then tap 'Concord' to install."
    echo "  Press Ctrl+C to stop the server."
    bold "=========================================="
    echo ""

    cd "$DIST_DIR"
    python3 -m http.server "$PORT" --bind 0.0.0.0
}

# Main
case "${1:-build}" in
    build)
        build_rust
        build_frontend
        build_xcode
        package_ipa
        green ""
        green "Build complete! .ipa at: $DIST_DIR/Concord.ipa"
        green "Run './scripts/build-ios.sh serve' to start the AltStore server."
        ;;
    serve)
        build_rust
        build_frontend
        build_xcode
        package_ipa
        serve
        ;;
    serve-only)
        serve
        ;;
    *)
        echo "Usage: $0 [build|serve|serve-only]"
        exit 1
        ;;
esac

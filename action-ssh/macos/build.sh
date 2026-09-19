#!/bin/zsh
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
app="$root/dist/Agent OS Remote.app"
macos="$app/Contents/MacOS"
mkdir -p "$macos"

xcrun swiftc -parse-as-library \
  -target arm64-apple-macos14 \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  -o "$macos/Agent OS Remote" \
  "$root/AgentOsRemoteApp.swift"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent OS Remote</string>
  <key>CFBundleIdentifier</key><string>ai.agentos.remote</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>Agent OS Remote</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$app/Contents/PkgInfo"
chmod +x "$macos/Agent OS Remote" "$root/agent-os-remote" "$root/pair.sh" "$root/build.sh"
echo "Built $app"
echo "Open with: open \"$app\""

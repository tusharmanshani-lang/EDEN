#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
app=EDENVoice.app/Contents
mkdir -p "$app/MacOS"
cp Info.plist "$app/Info.plist"
xcrun swiftc -swift-version 5 -framework Speech -framework AVFoundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
  -Xlinker Info.plist listener.swift -o "$app/MacOS/EDENVoice"
/usr/bin/codesign --force --sign - EDENVoice.app

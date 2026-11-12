#!/bin/bash
set -euo pipefail
image=$1
archive=$2
team=$3
work=$(mktemp -d)
mount="$work/disk"
detach() {
  if mount | grep -Fq " on $mount ("; then hdiutil detach "$mount" -quiet || return; fi
  /bin/rm -rf "$work"
}
trap detach EXIT
mkdir "$mount" "$work/zip"
download="$work/download.dmg"
ditto "$image" "$download"
stamp=$(printf '%x' "$(date +%s)")
xattr -w com.apple.quarantine "0083;$stamp;Safari;$(uuidgen)" "$download"
# 배포 DMG 자체와 그 안의 앱, 업데이트 ZIP 안 앱을 각각 검사한다.
xcrun stapler validate "$download"
spctl --assess --type open --context context:primary-signature --verbose=4 "$download"
hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$download" -quiet
ditto -x -k "$archive" "$work/zip"
mkdir "$work/Applications"
ditto "$mount/Flowrium.app" "$work/Applications/Flowrium.app"
xattr -w com.apple.quarantine "0083;$stamp;Safari;$(uuidgen)" "$work/Applications/Flowrium.app"
for bundle in "$work/Applications/Flowrium.app" "$work/zip/Flowrium.app"; do
  codesign --verify --deep --strict --verbose=2 "$bundle"
  signature=$(codesign -dv --verbose=4 "$bundle" 2>&1)
  grep -Fq "TeamIdentifier=$team" <<<"$signature"
  grep -Fq "Authority=Developer ID Application:" <<<"$signature"
  test "$(lipo -archs "$bundle/Contents/MacOS/Flowrium")" = arm64
  xcrun stapler validate "$bundle"
  spctl --assess --type execute --verbose=4 "$bundle"
  syspolicy_check distribution "$bundle"
done

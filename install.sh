#!/bin/bash
set -euo pipefail
fail(){ printf '%s\n' "$*" >&2; exit 1; }
usage(){ cat <<'TEXT'
사용법: bash install.sh [--version 0.4.0] [--from-source] [--install-dir 폴더]
       bash install.sh --package 로컬파일 --checksums SHA256SUMS.txt [--verify-only]
Mac Apple Silicon 전용입니다. 기본 위치는 ~/Applications/Flowrium.app입니다.
--from-source는 Node.js 24 이상 / npm / Apple 명령줄 도구가 필요합니다.
보안 설정을 변경하지 않습니다. 설치 후 앱 실행은 직접 진행하세요.
TEXT
}
requested='' source_mode=0 verify_only=0 package='' checksum_file='' support_file='' install_dir="$HOME/Applications"
while [ "$#" -gt 0 ]; do
 case "$1" in
  --version|--package|--checksums|--install-dir|--support-file) [ "$#" -ge 2 ] || fail '옵션 값을 입력해 주세요.'; case "$1" in --version) requested="$2";; --package) package="$2";; --checksums) checksum_file="$2";; --install-dir) install_dir="$2";; --support-file) support_file="$2";; esac; shift 2;;
  --from-source) source_mode=1; shift;; --verify-only) verify_only=1; shift;; --help|-h) usage; exit 0;; *) fail '지원하지 않는 옵션입니다. --help로 사용법을 확인하세요.';;
 esac
done
[ "$(uname -s)" = Darwin ] || fail '이 설치 파일은 Mac 전용입니다. Windows에서는 install.ps1을 사용하세요.'
[ "$(uname -m)" = arm64 ] || fail 'Mac Apple Silicon의 기본 터미널에서 실행하세요. Intel Mac과 변환 모드는 지원하지 않습니다.'
[[ "$requested" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ || -z "$requested" ]] || fail '버전 형식을 확인해 주세요.'
[[ "$install_dir" = /* && "$install_dir" != / ]] || fail '설치 폴더는 루트 이외의 절대 경로로 지정하세요.'
if [ -n "$package" ]; then [ -f "$package" ] && [ -n "$checksum_file" ] && [ -f "$checksum_file" ] || fail '로컬 설치 파일과 SHA256SUMS.txt를 함께 지정하세요.'; elif [ -n "$checksum_file" ]; then fail '로컬 체크섬은 --package와 함께 지정하세요.'; fi
assert_stopped(){ if /usr/bin/pgrep -x Flowrium >/dev/null 2>&1 || /usr/bin/pgrep -f '/Flowrium[.]app/Contents/' >/dev/null 2>&1; then fail 'Flowrium이 실행 중입니다. 앱과 관련 작업을 종료한 뒤 다시 설치하세요.'; fi; }
assert_stopped
work=$(mktemp -d "${TMPDIR:-/tmp}/flowrium-install.XXXXXXXX")
staged='' backup='' installed=0
cleanup(){ result=$?; if [ "$result" -ne 0 ] && [ -n "$backup" ] && [ -e "$backup" ] && [ ! -e "$install_dir/Flowrium.app" ]; then mv "$backup" "$install_dir/Flowrium.app" || true; fi; [ -z "$staged" ] || rm -rf "$staged"; rm -rf "$work"; exit "$result"; }
trap cleanup EXIT
base='https://github.com/hyeondk/flowrium/releases/latest/download'
[ -z "$requested" ] || base="https://github.com/hyeondk/flowrium/releases/download/v$requested"
download(){ /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 20 --max-time 900 --output "$2" "$1" || fail '릴리스 파일을 다운로드하지 못했습니다.'; }
if [ -z "$checksum_file" ]; then checksum_file="$work/SHA256SUMS.txt"; download "$base/SHA256SUMS.txt" "$checksum_file"; fi
checksum(){
 local wanted="$1" found='' digest name extra
 while read -r digest name extra; do
  name="${name#\*}"
  if [ "$name" = "$wanted" ]; then [[ "$digest" =~ ^[0-9a-fA-F]{64}$ ]] && [ -z "${extra:-}" ] && [ -z "$found" ] || fail '체크섬 목록의 중복 또는 형식을 확인해 주세요.'; found="$digest"; fi
 done < "$checksum_file"
 [ -n "$found" ] || fail '릴리스에 해당 파일의 SHA-256 값이 없습니다.'
 printf '%s' "$found" | tr 'A-F' 'a-f'
}
suffix='-mac-arm64.zip'; [ "$source_mode" -eq 0 ] || suffix='-source.tar.gz'
if [ -z "$package" ]; then
 names=$(awk -v suffix="$suffix" '{n=$2;sub(/^\*/,"",n);if(index(n,"Flowrium-")==1&&substr(n,length(n)-length(suffix)+1)==suffix)print n}' "$checksum_file")
 [ "$(printf '%s\n' "$names" | wc -l | tr -d ' ')" = 1 ] && [ -n "$names" ] || fail '릴리스의 설치 파일을 하나로 확인하지 못했습니다.'
 name="$names"; [[ "$name" =~ ^Flowrium-[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(-mac-arm64.zip|-source.tar.gz)$ ]] || fail '설치 파일 이름을 확인해 주세요.'
 package="$work/$name"; download "$base/$name" "$package"
else name=$(basename "$package"); fi
release_version="${name#Flowrium-}"; release_version="${release_version%$suffix}"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ && "$name" = "Flowrium-$release_version$suffix" ]] || fail '설치 파일의 제품 이름과 아키텍처를 확인해 주세요.'
[ -z "$requested" ] || [ "$requested" = "$release_version" ] || fail '설치 파일과 요청한 버전이 다릅니다.'
expected=$(checksum "$name"); actual=$(/usr/bin/shasum -a 256 "$package" | awk '{print $1}')
[ "$actual" = "$expected" ] || fail 'SHA-256 검증에 실패했습니다. 파일을 실행하지 않았습니다.'
printf '릴리스 검증 완료 / Flowrium %s\n' "$release_version"
if [ "$source_mode" -eq 1 ]; then
 command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 || fail '소스 빌드에는 Node.js 24 이상과 npm이 필요합니다.'
 node -e 'if(process.platform!=="darwin"||process.arch!=="arm64"||Number(process.versions.node.split(".")[0])<24)process.exit(1)' || fail 'Apple Silicon용 Node.js 24 이상을 사용하세요.'
 helper="$work/flowrium-install-support.cjs"
 if [ -n "$support_file" ]; then [ -f "$support_file" ] || fail '로컬 소스 검증 도구를 찾지 못했습니다.'; cp "$support_file" "$helper"; else download "$base/flowrium-install-support.cjs" "$helper"; fi
 [ "$(/usr/bin/shasum -a 256 "$helper" | awk '{print $1}')" = "$(checksum flowrium-install-support.cjs)" ] || fail '소스 검증 도구의 SHA-256 값이 다릅니다.'
 source_root=$(node "$helper" extract-source "$package" "$work/source" "$release_version") || fail '소스 묶음의 경로와 제품 검증에 실패했습니다.'
 if [ "$verify_only" -eq 1 ]; then printf '소스 검증 완료 / 빌드와 설치를 실행하지 않았습니다.\n'; exit 0; fi
 /usr/bin/xcode-select -p >/dev/null 2>&1 && /usr/bin/xcrun --find swiftc >/dev/null 2>&1 || fail 'Apple 명령줄 도구를 먼저 설치하세요. xcode-select --install 명령으로 준비할 수 있습니다.'
 (cd "$source_root" && npm ci && node scripts/build-native.cjs && npm run dist:mac) || fail '소스 빌드에 실패했습니다. 기존 앱은 유지했습니다.'
 package="$source_root/release/Flowrium-$release_version-mac-arm64.zip"; [ -f "$package" ] || fail '직접 빌드한 Mac 설치 파일이 없습니다.'
fi
# 기본 압축 해제 도구는 상위 경로와 링크를 따라 외부 위치에 쓰는 동작을 차단합니다.
/usr/bin/tar -tf "$package" > "$work/entries" || fail 'Mac 설치 묶음을 읽지 못했습니다.'
while IFS= read -r entry; do [[ "$entry" = Flowrium.app || "$entry" = Flowrium.app/* || "$entry" = __MACOSX/* ]] || fail '설치 묶음에 다른 제품 경로가 있습니다.'; case "/$entry/" in */../*|*/./*|*\\*) fail '설치 묶음에 안전하지 않은 경로가 있습니다.';; esac; done < "$work/entries"
mkdir "$work/unpacked"
/usr/bin/tar -xf "$package" --no-same-owner -C "$work/unpacked" || fail '설치 묶음의 안전한 압축 해제에 실패했습니다.'
app="$work/unpacked/Flowrium.app"; [ -d "$app" ] && [ ! -L "$app" ] || fail 'Flowrium 앱 묶음을 찾지 못했습니다.'
resolve_link(){ local target="$1" next count=0 parent; while [ -L "$target" ]; do count=$((count+1)); [ "$count" -lt 40 ] || fail '앱 링크가 순환하고 있습니다.'; next=$(readlink "$target"); [[ "$next" != /* ]] || fail '앱 묶음에 절대 경로 링크가 있습니다.'; target="$(dirname "$target")/$next"; done; [ -e "$target" ] || fail '앱 링크 대상이 없습니다.'; if [ -d "$target" ]; then (cd -P "$target" && pwd); else parent=$(cd -P "$(dirname "$target")" && pwd) || fail '앱 링크를 확인하지 못했습니다.'; printf '%s/%s\n' "$parent" "$(basename "$target")"; fi; }
while IFS= read -r -d '' link; do resolved=$(resolve_link "$link") || fail '앱 링크를 확인하지 못했습니다.'; [[ "$resolved" = "$app"/* ]] || fail '앱 묶음 밖의 링크가 있습니다.'; done < <(find "$app" -type l -print0)
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = io.github.hyeondk.flowrium ] || fail '앱의 제품 식별자가 다릅니다.'
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist")" = "$release_version" ] || fail '앱의 버전이 릴리스와 다릅니다.'
[ "$(/usr/bin/lipo -archs "$app/Contents/MacOS/Flowrium")" = arm64 ] || fail 'Apple Silicon 전용 앱이 아닙니다.'
/usr/bin/codesign --verify --deep --strict "$app" || fail '앱 서명 무결성 검증에 실패했습니다. 보안 설정은 변경하지 않았습니다.'
if [ "$verify_only" -eq 1 ]; then printf '앱 구조 / Apple Silicon / 서명 무결성 검증 완료 / 설치하지 않았습니다.\n'; exit 0; fi
assert_stopped
mkdir -p "$install_dir"; install_dir=$(cd -P "$install_dir" && pwd)
[ ! -L "$install_dir/Flowrium.app" ] || fail '설치 위치의 앱이 다른 위치를 가리키고 있습니다.'
staged=$(mktemp -d "$install_dir/.flowrium-install.XXXXXXXX")
/usr/bin/ditto "$app" "$staged/Flowrium.app" || fail '설치 위치에 앱을 복사하지 못했습니다.'
/usr/bin/codesign --verify --deep --strict "$staged/Flowrium.app" || fail '복사한 앱의 무결성 검증에 실패했습니다.'
assert_stopped
if [ -e "$install_dir/Flowrium.app" ]; then backup="$install_dir/Flowrium.app.backup-$(date '+%Y%m%d-%H%M%S')-$$"; [ ! -e "$backup" ] || fail '같은 이름의 백업이 있습니다.'; mv "$install_dir/Flowrium.app" "$backup"; fi
mv "$staged/Flowrium.app" "$install_dir/Flowrium.app" || fail '새 앱을 설치하지 못했습니다. 기존 앱 복원을 시도합니다.'
installed=1
printf '설치 완료 / %s/Flowrium.app\n' "$install_dir"
[ -z "$backup" ] || printf '이전 앱 백업 / %s\n' "$backup"
printf '프로젝트와 대화 데이터는 보존했습니다. 설치한 앱을 직접 실행하세요.\n공개 다운로드본은 Apple 확인 경고가 표시될 수 있으며 이 설치기는 보안 정책을 변경하지 않습니다.\n'

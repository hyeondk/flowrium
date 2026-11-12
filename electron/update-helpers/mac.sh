#!/bin/sh
# 이미 검증된 앱을 같은 볼륨에서 교체한다. 이전 프로세스와 그 실행 파일은 건드리지 않는다.
set -u
old_pid=$1
stage=$2
target=$3
prepared=$4
result=$5
backup="$stage/previous.app"
fail() { /usr/bin/printf 'failed\n' > "$result"; }
discard_stage() { /bin/rm -rf "$stage"; }
waited=0
while /bin/kill -0 "$old_pid" 2>/dev/null; do
  if [ "$waited" -ge 120 ]; then fail; discard_stage; exit 1; fi
  /bin/sleep 1
  waited=$((waited + 1))
done
if ! /bin/mv "$target" "$backup"; then
  fail
  /usr/bin/open -n "$target"
  discard_stage
  exit 1
fi
if /bin/mv "$prepared" "$target"; then
  if /usr/bin/open -n "$target"; then discard_stage; exit 0; fi
  fail
  /bin/mv "$target" "$stage/rejected.app" || exit 1
fi
fail
if /bin/mv "$backup" "$target"; then
  /usr/bin/open -n "$target"
  discard_stage
fi
exit 1

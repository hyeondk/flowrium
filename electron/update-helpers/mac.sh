#!/bin/sh
set -u
old_pid=$1
stage=$2
target=$3
prepared=$4
result=$5
token=$6
receipt=$7
backup="$stage/previous.app"
executable="$target/Contents/MacOS/Flowrium"
fail() { /usr/bin/printf 'failed\n' > "$result"; }
discard_stage() { /bin/rm -rf "$stage"; }
clear_receipt() { /bin/rm -f "$receipt.json" "$receipt.starting" "$receipt.ready"; }
trap clear_receipt EXIT
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

# LaunchServices 경로로 열고, 새 프로세스가 실제 화면 초기화를 마칠 때까지 원본을 보관한다.
matches_launch() {
  case "$1" in ''|*[!0-9]*) return 1;; esac
  process_executable=$(/bin/ps -ww -p "$1" -o comm= 2>/dev/null) || return 1
  # 파일 시스템에서 동일한 실행 파일인지 비교해 한글 경로의 유니코드 표현 차이도 처리한다.
  [ "$process_executable" -ef "$executable" ] || return 1
  command_line=$(/bin/ps -ww -p "$1" -o command= 2>/dev/null) || return 1
  case "$command_line " in *" --flowrium-update-token=$token "*) return 0;; *) return 1;; esac
}
if /bin/mv "$prepared" "$target"; then
  /usr/bin/open -n -W "$target" --args "--flowrium-update-token=$token" &
  opener=$!
  waited=0
  while [ "$waited" -lt 120 ]; do
    if [ -s "$receipt.ready" ] && [ -s "$receipt.starting" ]; then
      ready=$(/bin/cat "$receipt.ready")
      if [ "$ready" = "$(/bin/cat "$receipt.starting")" ] && matches_launch "$ready"; then
        /bin/kill -TERM "$opener" 2>/dev/null || true
        discard_stage
        exit 0
      fi
    fi
    /bin/kill -0 "$opener" 2>/dev/null || break
    /bin/sleep 1
    waited=$((waited + 1))
  done
  fail
  # 오래 걸리거나 정지된 새 앱이 아직 파일을 쓰고 있다면 종료한 뒤 교체한다.
  pid=''
  if [ -s "$receipt.starting" ]; then pid=$(/bin/cat "$receipt.starting"); fi
  if ! matches_launch "$pid"; then
    # 초기 신호보다 먼저 런타임이 멈춘 경우에도 이 업데이트로 연 프로세스만 찾는다.
    for possible in $(/usr/bin/pgrep -f "flowrium-update-token=$token" 2>/dev/null); do
      if matches_launch "$possible"; then pid=$possible; break; fi
    done
  fi
  if matches_launch "$pid"; then
    /bin/kill -TERM "$pid" 2>/dev/null || true
    waited=0
    while matches_launch "$pid" && [ "$waited" -lt 10 ]; do /bin/sleep 1; waited=$((waited + 1)); done
    if matches_launch "$pid"; then /bin/kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  /bin/mv "$target" "$stage/rejected.app" || exit 1
fi
fail
if /bin/mv "$backup" "$target"; then
  /usr/bin/open -n "$target"
  discard_stage
fi
exit 1

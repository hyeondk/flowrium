# 터미널에서 Flowrium 설치하기

Mac Apple Silicon과 Windows 64비트에서 사용할 수 있습니다. 설치기는 공식 GitHub 릴리스의 `SHA256SUMS.txt`와 다운로드 파일을 비교하고, 실행 중인 앱을 확인한 뒤 설치합니다. 기존 앱은 별도 이름으로 백업합니다. 프로젝트 폴더와 대화·로그인 데이터는 삭제하지 않습니다.

공증이나 배포용 서명이 없는 다운로드본은 Apple 또는 Windows의 확인 화면이 표시될 수 있습니다. 터미널 설치도 운영체제의 보안 판단을 바꾸지 않습니다. 설치기는 격리 속성, Gatekeeper, SmartScreen, Defender, PowerShell 실행 정책을 해제하지 않습니다. 보안 확인을 완전히 없앤 공개 설치를 보장하지 않습니다.

## Mac Apple Silicon

아래 명령은 설치기를 파일로 내려받습니다. 파일을 확인한 다음 별도 명령으로 실행하세요. 원격 응답을 바로 셸에 연결하지 않습니다.

```bash
curl --fail --location --proto '=https' --proto-redir '=https' \
  --output Flowrium-install.sh \
  https://github.com/hyeondk/flowrium/releases/latest/download/install.sh
less Flowrium-install.sh
bash Flowrium-install.sh
```

기본 설치 위치는 `~/Applications/Flowrium.app`입니다. 설치가 끝나면 Finder에서 이 앱을 실행하세요. `/Applications`의 이전 앱을 갱신하려면 해당 위치의 쓰기 권한이 있어야 하며 다음처럼 위치를 지정할 수 있습니다.

첫 실행이나 앱 교체 뒤 `Flowrium Safe Storage` 키체인 확인이 나타나면 macOS 창에 맥 사용자 로그인 암호를 입력합니다. 키체인 암호를 따로 바꾼 경우에는 해당 암호를 사용합니다. 출처를 확인한 앱의 키 사용을 허용하려면 **항상 허용**을 선택할 수 있습니다. 앱의 서명이나 위치가 달라지면 다시 확인할 수 있으며 기존 키체인 항목은 삭제하지 않습니다.

```bash
bash Flowrium-install.sh --install-dir /Applications
```

설치기는 실행 중인 Flowrium을 강제로 종료하지 않습니다. 앱과 관련 작업을 종료한 뒤 다시 실행하세요. 기존 앱의 백업은 같은 폴더의 `Flowrium.app.backup-날짜-식별자`에 남습니다. 새 앱이 정상 동작하는지 확인한 다음 이전 앱 백업의 보관 여부를 직접 결정하세요.

## Windows 64비트

일반 PowerShell에서 설치기를 내려받고 확인한 뒤 실행합니다. 관리자 권한이나 실행 정책 우회를 기본 요구하지 않습니다.

```powershell
Invoke-WebRequest `
  -Uri 'https://github.com/hyeondk/flowrium/releases/latest/download/install.ps1' `
  -OutFile '.\Flowrium-install.ps1' -UseBasicParsing
Get-Content '.\Flowrium-install.ps1'
& '.\Flowrium-install.ps1'
```

기본 위치는 `%LOCALAPPDATA%\Programs\Flowrium\Flowrium.exe`입니다. 실행 정책이나 보안 소프트웨어가 스크립트 또는 설치본을 차단하면 해당 조직의 허용 절차를 따르거나 GitHub의 설치본을 직접 실행하세요. 이 문서는 보안 정책을 끄는 명령을 제공하지 않습니다.

다른 폴더를 사용할 때는 로컬 드라이브의 Flowrium 전용 절대 경로를 지정하세요.

```powershell
& '.\Flowrium-install.ps1' -InstallDir 'D:\Programs\Flowrium'
```

기존 설치 폴더는 `Flowrium.backup-날짜-식별자`에 복사하고 파일 목록과 SHA-256을 대조해 보존합니다. 원래 위치의 제거 프로그램은 유지하므로 Windows 설치 프로그램이 기존 설치를 정상 갱신할 수 있습니다. 설치 실패 시 이전 앱 복원을 시도하고 실패한 설치 자료도 별도 폴더에 보관합니다. 사용자 대화 데이터 위치를 설치 대상으로 지정하는 동작은 거절합니다.

## 직접 빌드해서 설치하기

다운로드한 실행 파일 대신 동일한 릴리스의 소스를 검증하고 현재 컴퓨터에서 빌드할 수 있습니다. `Flowrium-버전-source.tar.gz`와 소스 검증 보조 파일을 각각 체크섬으로 확인합니다. 추출 전에 경로와 파일 유형, 제품 이름·버전, 잠금 파일과 필수 빌드 절차를 검증합니다.

준비할 항목은 Node.js 24 이상과 npm입니다. Mac에는 Apple 명령줄 도구와 Swift 컴파일러가 필요합니다. 설치되어 있지 않다면 Apple에서 제공하는 절차로 준비하세요.

```bash
xcode-select --install
bash Flowrium-install.sh --from-source
```

```powershell
& '.\Flowrium-install.ps1' -FromSource
```

검증된 임시 소스에서 `npm ci`와 해당 운영체제의 배포 빌드를 실행합니다. 배포 빌드는 고정 버전과 체크섬을 사용하는 내장 런타임 준비도 포함합니다. Mac의 네이티브 연결 도우미는 로컬 Swift 컴파일러로 빌드합니다. 이 과정에는 npm과 공식 도구 다운로드를 위한 인터넷 연결이 필요하며 기기 성능과 회선에 따라 시간이 달라집니다.

Mac에서 직접 빌드한 최종 앱도 `~/Applications/Flowrium.app`에 설치됩니다. 로컬 빌드는 Apple의 공증된 배포자 인증과 같지 않습니다. 보안 판단을 해제하지 않으며 모든 환경에서 경고가 없다고 보장하지 않습니다.

## 버전 고정과 설치 전 검증

```bash
bash Flowrium-install.sh --version 0.5.0
bash Flowrium-install.sh --version 0.5.0 --verify-only
```

```powershell
& '.\Flowrium-install.ps1' -Version '0.5.0'
& '.\Flowrium-install.ps1' -Version '0.5.0' -VerifyOnly
```

특정 릴리스의 파일을 직접 내려받은 경우 같은 릴리스의 체크섬을 함께 지정할 수 있습니다.

```bash
bash Flowrium-install.sh \
  --package ./Flowrium-0.5.0-mac-arm64.zip \
  --checksums ./SHA256SUMS.txt --verify-only
```

```powershell
& '.\Flowrium-install.ps1' `
  -Package '.\Flowrium-0.5.0-win-x64.exe' `
  -Checksums '.\SHA256SUMS.txt' -VerifyOnly
```

로컬 소스 검증은 `--from-source` / `-FromSource`에 소스 묶음을 지정하고 `--support-file` / `-SupportFile`로 내려받은 `flowrium-install-support.cjs`를 추가합니다. 보조 파일도 같은 체크섬 목록으로 확인하므로 임의 코드를 신뢰하는 우회 옵션이 아닙니다. 체크섬은 다운로드 파일의 일치 여부를 확인하며, 별도의 배포자 서명 인증을 대신하지 않습니다.

## 검증 스크립트

```bash
node --test tests/installer-support.test.cjs
node tests/installer-mac-e2e.cjs
```

Windows 러너에서는 다음 명령으로 실제 PowerShell 설치기의 검증·거절 흐름을 검사합니다. 실제 설치본을 지정한 마지막 명령은 일회용 GitHub Actions 러너에서만 실행되며 임시 폴더 설치와 기존 앱 백업, 분리한 사용자 데이터 보존까지 확인합니다. 종료 시 그 임시 설치의 제거 프로그램으로 등록 정보와 바로가기도 정리합니다.

```powershell
node --test tests/installer-support.test.cjs
node tests/installer-windows-e2e.cjs
node tests/installer-windows-e2e.cjs --installer release/Flowrium-0.5.0-win-x64.exe --checksums release/SHA256SUMS.txt
```

이 테스트는 생성한 임시 자료와 검증 프로세스를 종료·정리합니다. 기존 프로젝트와 로그인 정보를 검증 대상으로 사용하지 않습니다.

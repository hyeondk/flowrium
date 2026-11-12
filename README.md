# Flowrium

ChatGPT 계정으로 Codex와 함께 작업하는 개인용 데스크톱 앱입니다. 프로젝트별로 계획 / 구현 / 검토를 실행하고 대화 맥락을 이어갑니다. 화면은 흰색 / 옅은 회색 / 차콜을 사용하는 단색 구성입니다.

[다운로드 페이지](https://hyeondk.github.io/flowrium/) / [설치 파일과 릴리스](https://github.com/hyeondk/flowrium/releases) / [소스 저장소](https://github.com/hyeondk/flowrium)

위 주소는 배포 대상입니다. 실제 공개 여부와 다운로드 가능 파일은 릴리스 상태를 기준으로 확인합니다.

![Flowrium 실제 실행 화면](docs/workspace.png)

## 설치

Mac Apple Silicon은 `mac-arm64.dmg`, Mac Intel은 `mac-x64.dmg`, Windows 64비트 PC는 `win-x64.exe` 파일을 선택합니다. 설치 파일에는 앱 실행에 필요한 런타임과 해당 운영체제용 Codex가 포함되며 Node.js를 별도로 설치할 필요가 없습니다.

Mac은 DMG를 열고 Flowrium을 응용 프로그램 폴더로 옮깁니다. Windows는 설치 프로그램을 실행해 설치 위치를 선택합니다. 초기 버전은 정식 Developer ID 서명 / Apple 공증 / Windows 코드 서명이 완료되지 않은 개발용 배포일 수 있습니다. 설치 전에 해당 릴리스의 서명 상태를 확인하세요. Mac의 임시 서명은 정식 배포 서명과 공증을 대신하지 않습니다. 운영체제의 보안 설정 전체를 해제하지 마세요.

## 시작하기

1. Flowrium을 실행하고 프로젝트 폴더를 연결합니다.
2. Codex 연결을 누르고 필요하면 ChatGPT 계정으로 로그인합니다.
3. 새 작업을 만들고 계획 / 구현 / 검토 중 작업 방식을 선택합니다.
4. 요청을 보내고 진행 상황과 결과를 확인합니다. 승인 요청은 내용을 읽고 결정합니다.
5. 필요하면 작업을 중단하거나 대화를 내보냅니다.

인증은 공식 Codex가 관리합니다. Flowrium은 인증 파일과 브라우저 쿠키를 별도로 복사하지 않습니다. 모델 목록은 연결된 계정에서 실제로 제공하는 항목을 불러옵니다. Codex 실행 경로는 설정에서 바꿀 수 있습니다.

## Dropbox 프로젝트와 저장 위치

Dropbox 안의 프로젝트 폴더도 일반 폴더처럼 개별 연결합니다. 폴더 안에 `.flowrium/project.json`과 `.flowrium/sessions/`가 만들어집니다. 프로젝트 식별자와 대화 개정 기록을 함께 보관하므로 다른 Mac이나 Windows에서도 같은 폴더를 연결해 대화를 복원할 수 있습니다.

프로젝트 목록 / 기기별 설정 / Codex 실행 연결 식별자는 운영체제의 Flowrium 앱 데이터 위치에 보관합니다. 인증 정보와 Codex 내부 실행 이력은 프로젝트 기록과 별개이며, Codex 자체 이력이 공식 Codex 기본 저장소에도 남을 수 있습니다. 다른 기기에서는 저장된 대화 본문을 바탕으로 맥락을 이어가며 기존 프로세스 자체가 이동하지는 않습니다.

컴퓨터를 바꾸기 전에 Dropbox 동기화가 끝났는지 확인하세요. 동일한 대화를 여러 기기에서 동시에 수정하면 별도 개정이나 충돌이 생길 수 있으므로 한 기기에서 작업을 마친 뒤 다른 기기로 이어가는 방식을 권장합니다. 대화 삭제는 개정 기록에 삭제 표시를 남기는 방식이며 기존 보존 기록을 즉시 완전 삭제하는 기능이 아닙니다. 프로젝트 폴더를 삭제하거나 `.flowrium`을 제거하면 복원에 필요한 기록도 없어질 수 있습니다.

## 이전 대화에서 이어가기

Flowrium에서 작성한 대화는 연결한 프로젝트의 작업 기록에서 다시 선택합니다. 기존 Codex 대화 가져오기는 현재 컴퓨터에서 연결된 프로젝트에 대해 공식 Codex가 제공하는 사용자와 응답 본문만 선별해서 가져오는 범위입니다. 이 기능의 제공 여부는 설치한 버전의 릴리스 설명을 확인하세요.

도구 실행 로그 / 첨부 원본 / 일반 ChatGPT 웹 전체 대화 이력은 가져오기 대상이 아닙니다. ChatGPT 웹으로 이어가려면 앱에서 작업 맥락을 복사하고 ChatGPT를 연 뒤 직접 붙여 넣습니다. 일반 ChatGPT 대화 기록을 비공개 API로 자동 동기화하지 않습니다.

## 지원 범위와 검증

지원 패키지 대상은 Mac Apple Silicon / Mac Intel / Windows x64입니다. 다른 AI 서비스 연결은 포함하지 않습니다. 계획과 검토는 읽기 전용 작업, 구현은 프로젝트에 파일을 변경할 수 있는 작업으로 구분됩니다. 명령 실행과 파일 변경 권한은 Codex의 샌드박스와 승인 흐름을 따릅니다.

개발 과정에서 확인한 결과는 다음과 같습니다.

- 실제 Mac의 Electron 화면에서 12개 사용 시나리오를 확인했습니다.
- 백엔드 자동 검증 20개를 통과했습니다. 이후 기능 추가에 따른 최종 개수는 릴리스 설명을 기준으로 합니다.
- 실제 ChatGPT 계정 로그인 / 사용 가능한 모델 8개 조회 / 빈 폴더의 읽기 전용 요청 1건 완료 / 응답 저장을 확인했습니다.
- 다운로드 페이지의 파일 연결 규칙과 390 / 768 / 1280px 화면을 확인했습니다. 디자인 개정 후 화면 확인 결과는 최종 배포 검사에서 다시 확인합니다.

Windows 사용자의 실제 설치 / Mac Intel 실제 기기 실행 / 모든 계정과 모델 / 정식 서명과 Apple 공증은 별도 검증 대상입니다. 설치 파일 생성 성공을 이 항목들의 검증 완료로 표현하지 않습니다.

## 업데이트

새 릴리스의 설치 파일을 받아 기존 앱을 교체합니다. 자동 업데이트는 현재 제공하지 않습니다. 교체 전 실행 중인 작업을 마치고 중요한 프로젝트를 백업하세요. 앱 교체 시 프로젝트 안의 `.flowrium` 기록과 운영체제의 앱 데이터는 보존합니다. 기록 형식 변경이 있다면 해당 릴리스 설명을 먼저 확인합니다.

## 개발

소스 실행에는 Node.js 24 이상과 npm이 필요합니다.

```sh
npm ci
npm run dev
```

개발 실행기는 내부 주소 `http://127.0.0.1:5173`에서 화면을 준비한 뒤 데스크톱 창을 엽니다. 브라우저 화면만 확인하려면 `npm run dev:vite`를 사용합니다. 브라우저 미리보기에서는 폴더 선택과 Codex 실행 등 데스크톱 연결 기능을 사용할 수 없습니다.

```sh
npm run check
node scripts/verify-downloads.mjs
```

`npm run check`는 타입 검사 / 화면 번들 생성 / 백엔드 검증을 실행합니다. `src/`는 화면, `electron/`은 데스크톱 연결과 Codex 및 로컬 기록, `shared/`는 자료 형식, `docs/`는 다운로드 페이지, `scripts/`는 개발 및 배포 도구입니다.

Mac에서는 `npm run dist:mac`, Windows에서는 `npm run dist:win`으로 설치 파일을 만듭니다. 최종 파일은 `release/`에 생성됩니다. 패키징 실행기는 운영체제의 안전한 임시 출력 경로에서 빌드한 뒤 최종 파일을 옮기고 자신이 만든 임시 경로를 정리합니다. Mac에서 정식 서명 키가 없으면 개발용 임시 서명을 사용하며, 키가 설정되면 해당 서명과 공증 설정을 유지합니다.

## 배포

기본 저장소는 `hyeondk/flowrium`, 페이지 주소는 `https://hyeondk.github.io/flowrium/`입니다. 저장소를 바꿀 때는 `docs/release-config.mjs`와 `package.json`의 `build.publish`를 함께 변경합니다.

GitHub 저장소 설정의 Pages 게시 원본을 GitHub Actions로 선택하면 `pages.yml`이 다운로드 페이지를 게시합니다. `package.json`과 같은 버전인 `v0.1.0` 형식의 태그를 올리면 `release.yml`이 Mac Apple Silicon / Mac Intel / Windows를 각각 해당 운영체제의 실행기에서 빌드합니다. 빌드와 검사 성공 후 설치 파일과 `SHA256SUMS.txt`를 초안 릴리스에 보관합니다. 실제 결과와 서명 상태를 확인하고 릴리스 설명을 고친 뒤 공개합니다.

페이지는 최신 정식 공개 릴리스의 실제 자산만 연결합니다. 초안과 사전 공개 버전은 제외하며, 파일이 없으면 준비 중 상태를 표시합니다. API 확인이 실패하면 전체 릴리스에서 직접 확인할 수 있습니다.

정식 Mac 서명을 위한 저장소 비밀 값은 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD`, Apple 공증은 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`, Windows 서명은 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`입니다. 인증서와 암호를 소스에 저장하지 마세요. Mac 정식 배포에는 Developer ID 서명과 Apple 공증을 별도로 확인해야 합니다.

[공식 Codex 앱 서버 문서](https://learn.chatgpt.com/docs/app-server) / [공식 GitHub Pages 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) / [공식 코드 서명 문서](https://www.electron.build/v26/docs/features/code-signing/)

## 참고 출처

[Maestro 공개 다운로드 페이지](https://lhk228.github.io/maestro-download/)의 앱 실행 구조와 작업 흐름을 참고해 자체 화면과 연결 코드를 작성했습니다. 원본 앱의 인증 정보 / 배포 키 / 사용자 기록은 복사하지 않습니다. 원본 출처의 소유자와 Flowrium의 배포 계정은 별개입니다.

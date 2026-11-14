# Google 로그인 배포 준비

현재 공개 클라이언트 값은 비어 있습니다. 일정 화면과 조회·변경 검토는 구현했지만, 모든 사용자가 설정 없이 Google 로그인으로 연결하는 상태는 아닙니다. 본인 클라이언트를 설정한 사용자는 자신의 계정으로 연결할 수 있습니다.

## 배포자가 한 번 준비할 항목

1. 본인 Google 계정으로 [Google Cloud 콘솔](https://console.cloud.google.com/)에 로그인하고 Flowrium 프로젝트를 만듭니다. 이용약관이나 계정 확인이 나오면 소유자가 직접 처리합니다.
2. Calendar API를 켭니다. 메일과 드라이브 기능도 공개하려면 Gmail API와 Drive API를 켭니다.
3. Google Auth Platform의 브랜딩과 대상 사용자를 설정합니다. 홈페이지는 `https://hyeondk.github.io/flowrium/`, 개인정보 안내는 `https://hyeondk.github.io/flowrium/privacy.html`입니다. 지원 연락처와 개발자 연락처는 배포자 본인의 주소를 사용합니다.
4. 클라이언트 유형을 **데스크톱 앱**으로 선택하고 OAuth 설정 JSON을 내려받습니다. 웹 클라이언트나 서비스 계정 키를 사용하지 않습니다.
5. 아래 명령으로 내려받은 파일의 데스크톱 클라이언트 메타데이터만 배포 설정에 넣습니다. 원본 JSON이나 로그인 토큰을 저장소에 추가하지 않습니다.

```sh
node scripts/configure-google-client.cjs --public-client "/실제/내려받은/데스크톱-OAuth.json"
```

명령은 `installed` 유형을 확인하고 클라이언트 ID와 데스크톱 클라이언트 메타데이터만 `electron/google-client.json`에 저장합니다. 액세스 토큰, 갱신 토큰과 서비스 계정 키가 섞인 파일은 거절합니다. 각 사용자의 실제 로그인과 동의는 본인의 시스템 브라우저에서 진행하며 PKCE와 로컬 콜백을 사용합니다. 기존 사용자 설정이 있으면 그 설정을 우선합니다.

Google은 데스크톱 앱을 공개 클라이언트로 취급하며, 앱 안에 넣은 값을 비밀로 유지할 수 없다고 설명합니다. 로그인 토큰과 비밀번호는 이 공개 설정과 구분해야 합니다. [데스크톱 OAuth 안내](https://developers.google.com/identity/protocols/oauth2/native-app)

## 공개 연결을 완료하는 조건

클라이언트 값을 넣은 뒤 새 설치본을 만들고, 본인 계정의 실제 첫 로그인과 캘린더 조회·변경 검토를 확인합니다. 다른 사용자의 공개 접근은 Google의 게시 상태와 권한 검증 정책도 따라야 합니다. Calendar와 Gmail 권한을 쓰는 앱은 적용 범위와 예외에 따라 Google 검증이 필요할 수 있습니다. 앱 코드를 빌드한 사실이나 모의 동의를 통과한 사실로 이 절차를 완료했다고 표시하지 않습니다. [권한 검증 안내](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Calendar 권한](https://developers.google.com/workspace/calendar/api/auth), [Gmail 권한](https://developers.google.com/workspace/gmail/api/auth/scopes)

이 버전의 일정·메일·드라이브 연결은 조회 권한과 일정 편집·메일 발송 권한을 동의 화면에 함께 제시합니다. Google 계정을 연결해도 일정 변경과 발송은 자동 실행하지 않으며 앱의 검토와 사용자 실행 경로를 따릅니다.

## 준비 후 확인할 결과

- 새 프로필에서 개인 계정과 토큰이 없는 상태로 시작합니다.
- Google 연결 버튼으로 시스템 브라우저의 본인 계정 선택과 동의가 열립니다.
- 다른 사용자는 본인 계정의 자료만 조회하며 배포자 자료를 받지 않습니다.
- 일정 등록·수정·삭제는 미리보기에서 내용을 확인한 뒤 적용됩니다.
- 연결 해제와 권한 철회 뒤 API 조회가 중단됩니다. 이미 저장한 프로젝트 자료는 별도로 관리합니다.

공용 클라이언트 등록과 실제 계정 동의가 끝나기 전까지 Google 연결의 공개 운영 완료를 주장하지 않습니다.

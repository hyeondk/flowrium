# 로컬 음성 입력과 답변 읽기

Flowrium은 운영체제 기본 음성으로 답변을 읽습니다. 음성 입력에는 OpenAI API 또는 사용자가 이 기기에서 실행한 음성 인식 서버를 선택할 수 있습니다. 로컬 인식과 로컬 읽기는 API 키가 필요하지 않습니다. ChatGPT 계정의 모델 로그인과 음성 인식 API 키는 별개입니다.

앱이 음성 서버나 모델을 자동으로 설치하지 않습니다. 서버와 모델은 사용자가 선택해 설치합니다. 아래 주소는 각 프로젝트의 공식 배포 자료입니다. 기준 음성도 사용자가 직접 지정하며, 다른 앱의 모델이나 개인 음성을 찾아 읽지 않습니다.

## 로컬 음성 인식

[whisper.cpp 공식 소스와 설치 안내](https://github.com/ggml-org/whisper.cpp) 및 [서버 안내](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server)를 사용합니다. Mac에서는 Xcode 명령줄 도구와 CMake, Windows에서는 C++ 빌드 도구와 CMake가 필요합니다. 모델은 영어 전용 이름인 `.en`이 없는 다국어 모델을 선택합니다.

Mac 터미널 예시:

```sh
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
bash ./models/download-ggml-model.sh base
./build/bin/whisper-server -m models/ggml-base.bin --host 127.0.0.1 --port 9890 -l ko
```

Windows 개발자 PowerShell 예시:

```powershell
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release
Invoke-WebRequest -Uri https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -OutFile .\models\ggml-base.bin
.\build\bin\Release\whisper-server.exe -m .\models\ggml-base.bin --host 127.0.0.1 --port 9890 -l ko
```

설치 위치와 빌드 도구에 따라 실행 파일 위치가 다를 수 있습니다. Windows 다운로드 주소는 [공식 모델 안내](https://github.com/ggml-org/whisper.cpp/tree/master/models)에 연결된 모델 배포처입니다. 한 번 다운로드한 모델은 보관하며 앱 종료 때 삭제하지 않습니다.

Flowrium 설정의 **음성 인식 방식 → 이 기기의 로컬 음성 서버**를 선택하고 `http://127.0.0.1:9890`을 저장합니다. 연결할 때 `/inference`로 파일과 `response_format=json`, `language=ko`를 담은 multipart 요청을 보내고 `{ "text": "인식한 문장" }`을 받습니다. 마이크 구간은 16kHz / 16비트 / 모노 WAV로 변환합니다. 다른 형식의 음성 파일을 넣으려면 서버 쪽 변환 지원이 필요합니다.

## 로컬 답변 읽기

[GPT-SoVITS 공식 설치 안내와 배포 자료](https://github.com/RVC-Boss/GPT-SoVITS) 및 [공식 API 정의](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/api_v2.py)를 사용합니다. 운영체제와 장치에 맞는 공식 설치 절차로 서버와 모델을 준비합니다. Mac은 공식 안내의 Mac 설치 경로를, Windows는 공식 통합 배포 또는 설치 경로를 사용합니다. 별도 GPU와 모델에 따른 처리 속도 차이가 있습니다.

서버 실행 예시:

```sh
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```

Flowrium의 **답변 읽기 방식 → 로컬 음성 합성 서버**에서 `http://127.0.0.1:9880`, 서버가 읽을 수 있는 기준 음성 경로와 그 음성의 문장을 직접 지정합니다. 앱은 기준 음성 파일 자체를 열지 않고 입력한 경로를 로컬 서버에 전달합니다. `/tts`에 `text`, `text_lang=ko`, `ref_audio_path`, `prompt_text`, `prompt_lang=ko`, `media_type=wav`, `streaming_mode=false`, `speed_factor`를 담은 JSON 요청을 보내 WAV 응답을 재생합니다. 서버별 기본 기준 음성 처리 방식은 해당 서버 설정에 따릅니다.

## 연속 듣기와 호출어

**연속 듣기 사용**을 켠 뒤 마이크 버튼을 눌러 시작합니다. 말소리를 감지하고 설정한 무음 시간이 지나면 한 구간의 인식을 시작합니다. 여러 구간은 말한 순서로 처리하며, 같은 요청 식별자를 다시 보내도 한 번만 인식합니다. 호출어를 사용하면 이름 뒤 요청만 입력창에 넣습니다. 이름만 말한 경우에는 30초 안에 다음 요청을 이어 말할 수 있습니다.

**호출어 뒤 요청을 ChatGPT에 바로 전송**은 처음에는 꺼져 있습니다. 연속 듣기와 호출어를 모두 선택하고 이 항목까지 직접 켜야 자동 전송합니다. 선택하지 않으면 입력창에 문장만 추가합니다. 답변 생성 중에는 마이크를 닫았다가 종료 후 듣기를 이어가며, 중단 버튼이나 “대화 종료” 요청으로 종료할 수 있습니다. 화면 이동 / 창 숨김 / 앱 잠금 / 계정 전환 / 마이크 연결 종료 때에는 듣기를 종료합니다. 취소 후 도착한 권한과 인식 결과는 사용하지 않습니다.

로컬 서버는 `http://127.0.0.1` 주소와 포트만 사용할 수 있습니다. 다른 주소로의 리다이렉트는 허용하지 않습니다. 음성 파일은 최대 19MB, 로컬 읽기 WAV 응답은 최대 24MB이며 서버 요청은 120초 제한이 있습니다. 로컬 서버를 켜지 않았다면 설정만으로 인식 모델이 실행되지는 않습니다.

OpenAI API 인식은 [공식 음성 전사 API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)의 `gpt-4o-mini-transcribe` 모델과 JSON 결과를 사용합니다. API 키는 운영체제 보안 저장소로 암호화하며 화면이나 로컬 음성 서버에 전달하지 않습니다.

<div align="center">

# ⚔️ Web MOBA - 리그 오브 레전드 웹 아레나
**Pure JavaScript & Three.js Real-Time 60 FPS Multiplayer MOBA Engine**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-v22.13%2B-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-blue.svg)](https://socket.io/)
[![Three.js](https://img.shields.io/badge/Graphics-Three.js%20(NPR%20Toon)-ff69b4.svg)](https://threejs.org/)
[![Frame Rate](https://img.shields.io/badge/Engine-60%20FPS%20Locked-brightgreen.svg)](#)
[![QA Pass Rate](https://img.shields.io/badge/QA%20Tests-19%2F19%20PASS%20(100%25)-success.svg)](test/qa_suite.js)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

설치 없이 브라우저에서 즉시 구동되는 **실시간 60 FPS 쿼터뷰 탑다운 MOBA(League of Legends 정통 스타일) 웹 게임 엔진**입니다.  
사설망(프라이빗 LAN / 폐쇄망)에서도 인터넷 연결 없이 **100% 오프라인**으로 완벽하게 동작합니다.

[🎮 빠른 시작](#-빠른-시작-quick-start) • [🛡️ 챔피언 도감](docs/CHAMPIONS.md) • [🏗️ 시스템 아키텍처](docs/ARCHITECTURE.md) • [🎨 그래픽스 & 타격감](docs/GAME_FEEL_AND_GRAPHICS.md) • [📡 네트워크 프로토콜](docs/API_AND_PROTOCOL.md) • [🤝 오픈소스 기여](CONTRIBUTING.md)

</div>

원본 소환사의 협곡은 **2v2 / 5v5 / 커스텀**에서 적용됩니다. 1v1은 기존 단일 라인 맵을 유지합니다. 현재 설치된 LoL의 지형·미니맵·구조물·정글 몬스터를 사용하며, 원본 이동 격자로 벽 충돌과 우회 경로를 계산합니다. 상세 범위와 검증은 [협곡 통합 기록](docs/SUMMONERS_RIFT_INTEGRATION.md)을 참고하세요.

---

## 🌟 핵심 기술 및 엔진 특징 (Core Highlights)

### 1. 🎨 스타일라이즈드 툰 그래픽 (NPR Shader Pipeline)
* **3단계 그래디언트 맵 (3-Step Toon Ramp)**: 실사형 PBR의 플라스틱 질감을 배제하고 애니메이션 풍의 또렷한 3단계 음영 렌더링.
* **커스텀 림 라이팅 (Rim Lighting)**: 캐릭터 외곽에 셰이더 기반 발광 림 라이트를 적용하여 협곡 배경과 캐릭터를 시각적으로 분리.
* **인버티드 헐 외곽선 (Inverted Hull Mesh)**: 정점 노멀 확장 백페이스 렌더링으로 애니메이션 셀화 느낌의 날카롭고 균일한 실루엣 외곽선 구현.

### 2. 💥 4단계 동기 타격감 (Combat Juice Pipeline)
* **히트스톱 (Hit-Stop)**: 치명타 및 강력 스킬 적중 시 30~50ms 프레임 정지로 묵직한 물리 질량감 부여.
* **피격 플래시 (Damage Flash)**: 피격 대상 메쉬를 0.05초간 순백색(`0xffffff`)으로 발광 후 지수 감쇠 복구.
* **안정적인 트라우마 스크린 셰이크**: 평타/미니언 전투에서는 카메라 진동을 완전 차단하여 멀미 방지. 치명타/궁극기 적중 시에만 $Trauma^2$ 비선형 감쇠 적용 (카메라 롤링 `0.0` 고정).
* **플로팅 대미지 바운스**: $1.4\times$ 스케일 팝업 후 중력 가속도를 받아 바닥에서 탄성 바운스하는 2D 캔버스 수치 오버레이.

### 3. ⚡ 60 FPS 권위 서버 & 클라이언트 예측 (Authoritative Loop)
* **클라이언트 사이드 예측 (Client-Side Prediction)**: 우클릭 즉시 이동 벡터를 설정하고 720 deg/s 쿼터니언 Slerp로 자연스러운 턴 속도 적용.
* **지수 감쇠 보정 (Exponential Reconciliation)**: 서버 스냅샷 오차가 0.5 유닛 이하일 경우 부드러운 수렴 보정, 충돌/스턴 발생 시 정밀 스냅.
* **선착순 독점 밴픽 (Atomic Lock-In)**: 단일 스레드 원자적 픽 검증으로 4인 동시 클릭 시 1명 승인, 3명 충돌 방어.

### 4. 🏰 미니언 AI & 포탑 충돌 회피 (Minion & Turret Mechanics)
* **포탑 동적 우회 기동 (Flank Steering)**: 미니언이 직선 이동 중 포탑 반경(140px) 접근 시 포탑 양옆 외곽선으로 유연하게 곡선 우회.
* **하드 구조물 충돌 분리 (Hard Collision Resolution)**: 매 프레임 법선 방향 밀어내기(Pushback)로 포탑 및 넥서스 내부 침범 100% 방지.
* **포탑 포위 공격 진형**: 근접 미니언은 포탑 표면($r_{\text{turret}} + 18\text{px}$)에서 원형 진형 유지, 원거리/대포 미니언은 안전 사거리에서 포격.

### 5. 🛡️ 리그 오브 레전드 정통 헥스테크 HUD (LoL Hextech UI)
* **중앙 하단 액션 콘솔**: 좌측 초상화(골드 뱃지, AD/방어력/공속/이속), 중앙 스킬바(P, Q, W, E, R, 점멸/점화, 귀환) + 100 체력 단위 눈금선 체력/마나바, 우측 6칸 아이템 인벤토리 & [4]번 장신구.
* **우측 하단 분리형 미니맵**: 롤 고유 위치에 배치된 독립 석조 프레임 및 핑 버튼.
* **상단 스코어보드**: 팀별 킬수 대치, 게임 시간(00:00), 개인 KDA, CS, 골드, 실시간 FPS/Ping.

---

## 🕹️ 조작법 (Controls)

| 조작키 | 기능 | 세부 설명 |
| :---: | :---: | :--- |
| **마우스 우클릭** | **이동 & 공격** | 커서 위치로 즉시 이동 (녹색 핑) 또는 적 타겟팅 공격 |
| **Q / W / E / R** | **챔피언 스킬** | 마우스 커서 방향으로 스마트키 즉시 시전 |
| **D** | **소환사 주문 1** | 점멸 (Flash) - 커서 방향으로 380 거리 즉시 순간이동 |
| **F** | **소환사 주문 2** | 점화(Ignite) 또는 회복(Heal) 즉시 발동 |
| **B** | **귀환 (Recall)** | 8초간 집중 후 본진 귀환 및 체력/마나 회복 |
| **Y** | **카메라 시점 전환** | [Y] 챔피언 고정 시점 ↔ 자유 시점 (화면 가장자리 스크롤) 토글 |
| **SPACEBAR** | **챔피언 화면 집중** | 자유 시점 중 누르면 내 챔피언 위치로 즉시 화면 복귀 |
| **🔊 / 🔇 버튼** | **사운드 토글** | Web Audio API 절차적 오디오 On/Off 토글 |

---

## 🚀 빠른 시작 (Quick Start)

### 사전 요구사항
* [Node.js](https://nodejs.org/) v18.0.0 이상

### 설치 및 실행
```bash
# 1. 저장소 클론
git clone https://github.com/iamywl/Web_game.git
cd Web_game

# 2. 패키지 설치
npm install

# 3. 게임 서버 구동 (포트 3000)
npm start
```

### 브라우저 접속
* **로컬 접속**: `http://localhost:3000`
* **LAN 사설망 접속**: 콘솔 터미널에 출력된 `http://<LAN_IP>:3000` (같은 공유기 내 모든 기기 동시 접속 가능)

---

## 🧪 자동화 QA 테스트 스위트 (19개 전 항목 100% PASS)

4인 무인 가상 소켓 클라이언트를 구동하여 동시성, 물리 엔진, 네트워크 내결함성을 전수 검증합니다:

```bash
npm test
# 또는
node test/qa_suite.js
```

```
================================================================================
           ⚔️  LOL MOBA REAL-TIME ENGINE - AUTOMATED QA TEST SUITE  ⚔️
================================================================================
  • 1. Concurrency & Pick Exclusivity Race Condition: 6/6 passed (100%)
  • 2. 10 Champions Integrity & Server Info Test: 4/4 passed (100%)
  • 3. In-Game Battle Simulation & Combat Mechanics: 5/5 passed (100%)
  • 4. Disconnect & Edge Case Handling: 4/4 passed (100%)
================================================================================
  Passed: 19 / 19 (100.0%) | Total Elapsed: ~9.6s
✨ ALL QA TEST SUITES COMPLETED WITH 100% PASS RATE! ⚔️
```

---

## 📁 프로젝트 구조 (Project Directory Map)

```
Web_game/
├── server/
│   ├── server.js              # Express + Socket.IO 메인 서버 (LAN IP 자동 탐색 & HTTP API)
│   └── game/
│       ├── ChampionData.js    # 기존 10종 + 독립 가렌/야스오: 12종 챔피언, 48개 QWER 스킬
│       ├── GameEngine.js      # 60 FPS 서버 권한 루프, 미니언 AI, 투사체, 충돌, 스킬 연산
│       ├── Room.js            # 방 상태 머신 & 챔피언 선착순 독점 락인 (Race Condition 방어)
│       └── RoomManager.js     # LAN 유저 세션 및 방 매칭 라우팅
├── public/
│   ├── index.html             # Hextech HUD UI, 로비, 밴픽, 아레나 뷰
│   ├── css/style.css          # LoL 정통 흑요석 & 골드 헥스테크 테마 스타일
│   └── js/
│       ├── client.js          # SPA 상태 전환, 소켓 통신, 사용자 입력, UI 실시간 동기화
│       ├── renderer.js        # Three.js 씬, 협곡 맵, 타워/넥서스, 파티클 VFX
│       ├── nprMaterial.js     # 3단계 Gradient Toon 셰이더, Rim Lighting, Inverted Hull 외곽선
│       ├── camera.js          # 45~55° 쿼터뷰 탑다운 카메라, 화면 가장자리 스크롤, [Y] 고정 모드
│       ├── GameFeelController.js # 히트스톱, 트라우마 스크린 셰이크, 피격 플래시, 바운스 대미지 텍스트
│       ├── NetworkManager.js  # 클라이언트 예측, 쿼터니언 Slerp 회전 보간, 오차 스냅/보정
│       └── audio.js           # Web Audio API 실시간 절차적 사운드 신디사이저
├── test/
│   ├── qa_suite.js            # 4인 가상 소켓 클라이언트 기반 19개 E2E 통합 QA 테스트
│   └── qa_report.json         # QA 테스트 결과 리포트
├── docs/                      # 기술 문서 및 세부 아키텍처 가이드
│   ├── ARCHITECTURE.md        # 서버/클라이언트 시스템 및 네트워크 아키텍처
│   ├── GAME_FEEL_AND_GRAPHICS.md # NPR 툰 셰이딩 및 4단계 컴뱃 주스 상세 명세
│   ├── API_AND_PROTOCOL.md    # 소켓 이벤트 및 REST API 프로토콜 정의서
│   └── CHAMPIONS.md           # 12종 챔피언 스탯 및 스킬 가이드
├── AGENTS.md                  # LLM 에이전트 마스터 가이드
├── CLAUDE.md                  # Claude Code 전용 가이드
├── GEMINI.md                  # Google Gemini 전용 가이드
├── .cursorrules               # Cursor IDE 전용 룰셋
├── CONTRIBUTING.md            # 오픈소스 기여 가이드 (인간 & AI 공통)
└── package.json
```

---

## 🤖 AI / LLM 에이전트 기여 가이드 (Contributing with AI)

본 프로젝트는 AI 에이전트(Claude, GPT, Gemini, Cursor, Copilot 등)와의 페어 프로그래밍에 최적화되어 있습니다:
* **[AGENTS.md](AGENTS.md)**: AI 에이전트 행동 지침 및 아키텍처 원칙
* **[CLAUDE.md](CLAUDE.md)**: Anthropic Claude Code 전용 워크플로우
* **[.cursorrules](.cursorrules)**: Cursor IDE 전용 컨텍스트 룰셋
* **[.github/copilot-instructions.md](.github/copilot-instructions.md)**: GitHub Copilot 지침서
* **[.agent/rules/](.agent/rules/)**: 엔진, 그래픽스, QA 모듈별 특화 룰셋

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT License](LICENSE)에 따라 오픈소스로 배포됩니다.

### 독립 야스오 추가
기존 캐릭터와 가렌을 유지하고 `yasuo`를 별도 선택 항목으로 추가했습니다. 원본 모델·13개 애니메이션·17개 이펙트 텍스처·17개 효과음을 사용하며, 이동/평타/QWER와 Q3→R, E-Q를 서버 판정으로 연결했습니다. [조작·구현 범위·검증 기록](docs/YASUO_INTEGRATION.md)을 참고하세요.

### 원본 미니언·포탑
양 팀의 근접·원거리·대포·슈퍼 미니언 8종과 블루/레드 포탑에 원본 모델·텍스처·애니메이션을 연결했습니다. 기존 AI·공격·피해·웨이브·캐릭터를 유지하며, 사망/파괴 및 재경기 정리를 포함합니다. [적용 범위와 실제 경기 검증](docs/ORIGINAL_UNITS_INTEGRATION.md)을 참고하세요.

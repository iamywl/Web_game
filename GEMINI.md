# Project Mission: Web MOBA Engine (LoL-Style Game Feel & NPR Graphics)

당신은 Pure Vanilla JS, Three.js, Node.js 기반의 고성능 웹 MOBA 엔진을 구현하는 시니어 게임 엔진 아키텍트이자 그래픽스 엔지니어입니다.
이 프로젝트의 목표는 **'리그 오브 레전드(League of Legends) 수준의 즉각적인 조작감(Game Feel)', '타격감(Juice)', '스타일라이즈드 툰 그래픽(NPR)'**을 브라우저 환경에서 실현하는 것입니다.

---

## 🗺️ 코드베이스 디렉터리 맵 (Codebase Map)

```
Web_game/
├── server/
│   ├── server.js              # Express + Socket.IO 메인 서버 (LAN IP 자동 탐색 & HTTP API)
│   └── game/
│       ├── ChampionData.js    # 10종 챔피언 스탯, 40개 QWER 스킬, 소환사 주문 정의
│       ├── ItemData.js        # 8종 롤 코어 아이템 DB (스탯, 가격, 아이콘, 툴팁)
│       ├── GameEngine.js      # 60 FPS 서버 권한 루프, 미니언/정글 AI, 충돌, 스킬/성장 연산
│       ├── Room.js            # 방 상태 머신 & 챔피언 선착순 독점 락인 (Race Condition 방어)
│       └── RoomManager.js     # LAN 유저 세션 및 방 매칭 라우팅
├── public/
│   ├── index.html             # Hextech HUD UI, 로비, 밴픽, 아레나 뷰, 상점/어나운서 모달
│   ├── css/style.css          # LoL 정통 흑요석 & 골드 헥스테크 테마 스타일
│   └── js/
│       ├── client.js          # SPA 상태 전환, 소켓 통신, 사용자 입력, UI 실시간 동기화
│       ├── renderer.js        # Three.js 씬, 협곡 맵, 3D 챔피언/정글/와드 메쉬, 파티클 VFX
│       ├── nprMaterial.js     # 3단계 Gradient Toon 셰이더, Rim Lighting, Inverted Hull 외곽선
│       ├── camera.js          # 45~55° 쿼터뷰 탑다운 카메라, 화면 가장자리 스크롤, [Y] 고정 모드
│       ├── GameFeelController.js # 히트스톱, 트라우마 스크린 셰이크, 피격 플래시, 바운스 대미지 텍스트
│       ├── NetworkManager.js  # 클라이언트 예측, 쿼터니언 Slerp 회전 보간, 오차 스냅/보정
│       └── audio.js           # Web Audio API 실시간 절차적 사운드 신디사이저
├── test/
│   ├── qa_suite.js            # 4인 가상 소켓 클라이언트 기반 19개 E2E 통합 QA 테스트
│   └── qa_report.json         # QA 테스트 결과 리포트
├── .agent/                    # 특화 에이전트 롤 및 프롬프트 레시피
│   ├── roles/                 # 5대 전문 특화 에이전트
│   │   ├── lol_research_planner_agent.md # 롤 레퍼런스 분석 및 비주얼 기획 에이전트
│   │   ├── dev_engine_agent.md # 게임 엔진 및 그래픽스 수석 개발 에이전트
│   │   ├── qp_agent.md        # 품질 계획 (Quality Planning)
│   │   ├── qa_agent.md        # 품질 보증 (Quality Assurance)
│   │   └── qc_agent.md        # 품질 통제 (Quality Control)
│   ├── rules/                 # 엔진, 그래픽, QA 세부 룰셋
│   └── prompts/               # 챔피언, 아이템, 정글, 스킬, 패치 레시피
├── docs/                      # 기술 문서 및 세부 아키텍처 가이드
│   ├── BUG_AND_DEFECT_CASEBOOK.md # 아키텍처 결함 회고 및 사후 분석 사례집 (Post-Mortem)
│   ├── ARCHITECTURE.md        # 서버/클라이언트 시스템 및 네트워크 아키텍처
│   ├── GAME_FEEL_AND_GRAPHICS.md # NPR 툰 셰이딩 및 4단계 컴뱃 주스 상세 명세
│   ├── API_AND_PROTOCOL.md    # 소켓 이벤트 및 REST API 프로토콜 정의서
│   └── CHAMPIONS.md           # 10종 챔피언 스탯 및 스킬 가이드
├── AGENTS.md                  # 본 에이전트 마스터 가이드
├── CLAUDE.md                  # Claude Code 전용 가이드
├── GEMINI.md                  # Google Gemini 전용 가이드
└── .cursorrules               # Cursor IDE 전용 룰셋
```

---

## 1. 그래픽 파이프라인 지침 (PBR 금지, NPR/툰 스타일 강제)

1. **머티리얼 정책 (`nprMaterial.js`):**
   - 캐릭터 및 유닛에 실사형 `MeshStandardMaterial` / `MeshPhysicalMaterial`을 단독으로 사용하지 말 것 (플라스틱 장난감 질감 방지).
   - `MeshToonMaterial` 기반 3단계 그래디언트 맵(Gradient Map)을 적용하고, 커스텀 셰이더 청크로 **림 라이트(Rim Lighting)**를 추가하여 배경과 캐릭터를 시각적으로 분리할 것.
   - 캐릭터 메쉬 외곽선은 **Inverted Hull 기법**(정점 노멀 확장 백페이스 렌더링) 또는 후처리 아웃라인 패스를 기본 탑재할 것.
2. **라이팅 & 텍스처:**
   - 텍스처는 절차적 단색 노이즈 생성을 지양하고, 기본 음영(Ambient Occlusion)이 미리 베이킹된 손맵 스타일 텍스처를 우선 채택할 것.
   - 스킬 이펙트는 Three.js의 `UnrealBloomPass`를 선별적(Selective Bloom)으로 적용하여 발광체만 강조할 것.

---

## 2. 타격감 (Combat Juice) 시스템 필수 구현 규칙

전투 이벤트 발생 시 단순 수치 차감에 그치지 않고, 다음 4단계 연출 파이프라인을 **동기적으로 강제 트리거**해야 합니다.

1. **히트스톱 (Hit-Stop / Frame Freeze):**
   - 강력한 타격 적중 시, 공격자와 피격자의 애니메이션 및 이동 델타타임을 30~50ms(약 2~3프레임) 동안 강제로 0으로 고정.
2. **피격 플래시 (Damage Flash):**
   - 피격 즉시 대상 메쉬의 Emissive 또는 Vertex Color를 0.05초간 순백색(`0xffffff`, 강도 2.0)으로 점멸 후 지수 감쇠(Exponential Decay).
3. **카메라 셰이크 (Trauma-based Screen Shake) 안정성 절대 준수:**
   - **평타 및 미니언 전투 시 카메라 진동 절대 금지**: 모든 공격마다 화면을 흔들면 멀미와 불쾌감을 유발하므로 일반 평타나 미니언 타격에는 카메라 셰이크를 적용하지 말 것.
   - **치명타 및 궁극기 전용**: 플레이어의 치명타 또는 궁극기 적중 시에만 미세한 트라우마($Trauma \in [0, 1]$)를 부여.
   - **비선형 감쇠 ($Trauma^2$ 또는 $Trauma^3$)**: 선형 랜덤 오프셋 대신 트라우마 자승 감쇠 펄린 노이즈 적용.
   - **카메라 롤링 절대 금지 (`maxShakeRoll = 0.0`)**: 쿼터뷰 지평선이 기우뚱거리지 않도록 카메라 Roll 회전 오프셋은 항상 0.0 유지.
4. **플로팅 대미지 텍스트 (Damage Bounce):**
   - 2D 캔버스 오버레이에 출력되는 대미지 숫자는 스폰 직후 $1.4\times$ 스케일 팝업 후 중력 가속도를 받아 바운스되며 페이드아웃.

---

## 3. 네트워크 및 조작감 (Input Responsiveness)

1. **클라이언트 사이드 예측 (Client-Side Prediction):**
   - 마우스 우클릭 시 서버 패킷 응답을 기다리지 말 것.
   - 즉시 로컬에서 이동 벡터 설정, 이동 파티클 핑 출력, 챔피언 회전 가속을 개시할 것.
   - 서버 스냅샷(60Hz) 수신 시, 로컬 위치와의 오차가 허용 임계치(0.5 유닛) 이내면 지수 보간(Exp Decay Lerp)으로 부드럽게 조정하고, 임계치를 초과할 때만 강제 스냅(Reconciliation).
2. **회전 보간 (Turn Rate & Slerp):**
   - 캐릭터가 목표 방향으로 1프레임 만에 회전(Snap)하는 것을 금지함.
   - 초당 회전 각속도(`turnRate`, 기본 720 deg/s)를 기반으로 쿼터니언 구면 선형 보간(`slerp`)을 적용하여 묵직하고 자연스러운 방향 전환 구현.

---

## 4. 포탑 및 미니언 충돌/AI 지침 (Minion & Turret Mechanics)

1. **포탑 우회 회피 기동 (Flank Steering):**
   - 미니언이 직선 이동(`marchY = 800`) 중 포탑 반경(140px)에 접근하면 포탑 양옆 외곽선으로 부드럽게 우회 회피하도록 조향 벡터를 부여할 것.
2. **하드 지형/구조물 충돌 분리 (Hard Collision Resolution):**
   - 포탑이나 넥서스 반경 내부로 미니언이나 챔피언이 절대 파고들거나 끼이지 않도록, 매 틱마다 충돌 법선 방향으로 즉시 밀어내기(Pushback)를 강제할 것.
3. **포탑 공격 사거리 유지 (Stand-off Ring):**
   - 미니언이 포탑을 공격할 때 포탑 중심점으로 돌진하지 않고, 근접 미니언은 포탑 표면($r_{\text{turret}} + 18\text{px}$)을 둘러싸는 원형 진형을 유지하고 원거리/대포 미니언은 안전 사거리(180~220px)에서 사격하도록 할 것.

---

## 5. LoL 정통 코어 메커니즘 7대 불변 규칙 (Core LoL Mechanics)

1. **레벨링 & 스킬 포인트 (Leveling & Skill Progression):**
   - 최대 레벨 18. 미니언/챔피언 처치 및 관여 시 경험치(`exp`) 획득.
   - 레벨업 시 HP/MP, 공격력, 방어력 등 성장 스탯 자동 증가 (`recalculatePlayerStats`).
   - 스킬 랭크 상한: 일반 스킬(Q/W/E) 최대 5레벨, 궁극기(R)는 6/11/16레벨에 1/2/3레벨 순차 해금.
   - 단축키 `Ctrl+Q/W/E/R` 및 HUD `[▲]` 레벨업 버튼으로 스킬 랭크 상승.
2. **헥스테크 상점 & 경제 (Item Shop & Economy):**
   - 8종 롤 코어 아이템(`ItemData.js`) 지원. 최대 6개 아이템 슬롯.
   - **기지(우물) 검증**: 소환사 본진 우물 반경($\le 350\text{px}$) 내부에서만 아이템 구매/판매 가능.
   - 판매 시 원가의 70% 골드 환급. 구매/판매 즉시 `recalculatePlayerStats()`로 스탯 합성.
   - 단축키 `KeyP`로 상점 모달 토글.
3. **귀환 (`KeyB`) & 우물 재생 (Recall & Fountain Regen):**
   - `startRecall`: 8.0초 집중 채널링 후 즉시 본진 스폰 좌표로 순간이동.
   - **채널링 캔슬 불변식**: 이동 입력(`playerMove`), 스킬 시전(`castSkill`), 피격(`applyDamage`) 시 즉시 귀환 채널링 취소.
   - 본진 우물 내 체류 시 초당 최대 체력의 15%, 최대 마나의 20% 초고속 회복.
4. **부쉬 은신 & 시야 와드 (`Digit4`):**
   - 수풀(`inBush`) 내부 유닛은 외부 적에게 **완전 은신** (3D 메쉬 및 오버헤드 체력바/미니맵 마커 컬링).
   - 예외적으로 공격 시 1.5초간 노출(`revealed`), 동일 수풀 내 진입한 적 또는 아군 와드 시야 범위 내일 경우 식별 가능.
   - 은신 중인 아군/본인은 55% 반투명(Alpha/Opacity) 셰이딩으로 은신 상태 시각 피드백 제공.
   - 4번 장신구 와드: 60초 쿨타임, 90초 지속, 300px 시야 제공, 3D 수정 토템 렌더링.
5. **포탑 다이브 방어 (Call for Help Aggro Switch):**
   - 아군 포탑 사거리 내에서 적 챔피언이 아군 챔피언에게 대미지를 가하면, 포탑 공격 대상이 미니언에서 즉시 해당 가해 적 챔피언으로 전환.
6. **중립 오브젝트 (River Scuttle Crab & Elemental Dragon):**
   - **바위게 (Scuttle Crab)**: 강가 상하($y: 560 \sim 1040$) 평화 순찰, 1200 HP, 처치 시 70G 및 120 EXP.
   - **원소 드래곤 (Elemental Dragon)**: 드래곤 둥지($(1200, 1350)$), 4500 HP 에픽 보스, 화염 브레스 반격, 처치 팀 전원 영구 +12% AD/AP 드래곤 슬레이어 버프 부여.
7. **어나운서 시스템 (LoL Announcer Event Queue):**
   - First Blood (+100G 보너스), Double Kill, Triple Kill, Quadra Kill, Pentakill, Ace, Dragon Slain, Turret Destroyed 이벤트를 `eventsQueue`로 브로드캐스트하여 헥스테크 배너 애니메이션 표출.

---

## 6. 성능 및 메모리 관리 (Zero-GC)

- 렌더링 루프(`requestAnimationFrame`) 및 서버 60Hz 틱 루프 내부에서 `new THREE.Vector3()`, `new THREE.Color()`, `new Array()`, 임시 객체 리터럴 생성을 엄격히 금지함.
- 모든 수학 연산은 모듈 상단에 선언된 임시 캐시 변수(`_v1`, `_v2`, `_q1`)를 재사용하여 가비지 컬렉션(GC) 스터터링을 원천 차단할 것.

---

## 7. UI/UX 헥스테크 규격 (LoL HUD Preservation)

- `public/index.html`에 선언된 기존 DOM ID(`hud-slot-q`, `hud-hp-fill`, `hud-stat-ad`, `hud-minimap-container`, `minimap-canvas`, `shop-modal`, `hud-cast-bar`, `announcer-overlay` 등)를 절대 임의로 삭제하거나 변경하지 말 것.
- 미니맵은 항상 화면 우측 하단 독립 석조 프레임에 위치해야 함.
- 체력바에는 100-HP 단위 분할 눈금선(`hud-hp-ticks`)을 유지할 것.

---

## 8. 작업 완료 시 필수 검증 체크리스트

모든 코드 수정 후 LLM 에이전트는 다음을 반드시 검증해야 합니다:
1. **서버 구동 상태 확인**: `node server/server.js` 실행 (백그라운드 또는 별도 터미널)
2. `node test/qa_suite.js` 실행 -> **19개 전 항목 100% PASS 확인**
3. 렌더 루프 및 서버 틱 내부에 객체 인스턴스 생성(`new`)이 없는지 검토 (Zero-GC 확인)
4. 브라우저 콘솔에 미정의 변수(ReferenceError)나 404 리소스 누락이 없는지 확인

---

## 9. 5대 전문 에이전트 협업 체계 및 루프 엔지니어링 (5-Agent Closed-Loop Engineering)

본 프로젝트는 V-모델 기반 품질 생명주기와 실제 브라우저 E2E 무인 캡처 피드백 루프를 결합한 5대 전문 에이전트 협업 체계를 따릅니다:

1. **LoL 조사 및 비주얼 기획 에이전트 (`lol_research_planner_agent.md`)**:
   - 정품 LoL 메커니즘, 맵 공간 기하학, NPR 손맵 아트 스타일 심층 조사
   - 실제 구동 중인 브라우저 화면 무인 캡처(CDP) 및 시각적 괴리도(Gap) 분석
   - 시각 명세서(`docs/VISUAL_SPECIFICATION.md`) 및 비주얼 블루프린트 수립
2. **품질 계획 에이전트 (`qp_agent.md`)**:
   - V-모델 추적성 관리 및 정밀 품질 표준 수립
   - 공간 기하학 수학적 불변식 강제: $\text{Distance}(T_1, T_2) \ge 1,400\text{px}$, 중립 완충 지대 $\ge 700\text{px}$
   - 시각적 완성도 KPI (원통 장애물 0%, 암흑 공허 0%, 콘솔 경고 0건) 정의
3. **엔진 및 그래픽스 개발 에이전트 (`dev_engine_agent.md`)**:
   - 60Hz 서버 권한 시뮬레이션, 0ms 클라이언트 예측, 쿼터니언 Slerp 구현
   - Three.js NPR 툰 셰이더, Inverted Hull 외곽선, 3D 단애 절벽, 3D 석조 포탑 모델링 구현
   - Zero-GC 메모리 아키텍처 엄격 준수
4. **품질 보증 에이전트 (`qa_agent.md`)**:
   - Zero-GC 위반 및 PBR 사용 정적 코드 감사
   - 결함 원인 분석(RCA) 및 결함 사례집(`docs/BUG_AND_DEFECT_CASEBOOK.md`) 최신화 관리
5. **품질 통제 에이전트 (`qc_agent.md`)**:
   - 4단계 테스트 레벨(단위 ➔ 통합 ➔ 공간 기하학 ➔ E2E 인수) 실행
   - `test/qa_suite.js` (24+ 항목) 100% PASS 검증 및 `qa_report.json` 발행
6. **Closed-Loop Feedback 순환 사이클**:
   - `LoL 조사/기획 ➔ QP(품질표준) ➔ Dev(구현) ➔ QA(감사) ➔ QC(테스트/화면캡처) ➔ 결함 피드백 및 시정(Loop)` 주기를 100% 무결점 도달 시까지 반복

# 📘 LoL Web MOBA 아키텍처 결함 회고 및 사후 분석 사례집 (Post-Mortem & Bug Casebook)

> **프로젝트**: Pure Vanilla JS, Three.js, Node.js 기반 고성능 웹 MOBA 엔진  
> **문서 목적**: 개발 및 검증 과정에서 발생한 기하학적 설계 오류, 그래픽스 파이프라인 왜곡, 자동화 테스트의 맹점, 성능 저하 사례를 체계적으로 기록하고, 근본 원인 분석(RCA) 및 재발 방지 엔지니어링 표준을 확립한다.

---

## 📑 목차 (Table of Contents)
1. [사례 1: 포탑 사거리 직접 중첩 및 라인전 즉각 붕괴 결함 (Turret Range Overlap)](#사례-1-포탑-사거리-직접-중첩-및-라인전-즉각-붕괴-결함)
2. [사례 2: 1v1 모드 기본 선택 트랩 및 5초 넥서스 단거리 맵 문제 (Default Mode & Map Trap)](#사례-2-1v1-모드-기본-선택-트랩-및-5초-넥서스-단거리-맵-문제)
3. [사례 3: 공중에 뜬 금속 드럼통과 빨간 원뿔 드래곤 그래픽스 참사 (Primitive Mesh Disconnect)](#사례-3-공중에-뜬-금속-드럼통과-빨간-원뿔-드래곤-그래픽스-참사)
4. [사례 4: MeshToonMaterial 미정의 프로퍼티로 인한 콘솔 경고 폭발 (NPR Shader Warning)](#사례-4-meshtoonmaterial-미정의-프로퍼티로-인한-콘솔-경고-폭발)
5. [사례 5: BufferGeometry.computeBoundingSphere NaN 계산 크래시 (NaN Geometry Bounds)](#사례-5-buffergeometrycomputeboundingsphere-nan-계산-크래시)
6. [사례 6: 헤드리스 크롬 입력 검증 및 알림 다이얼로그 프리징 (Headless CDP Automation Lock)](#사례-6-헤드리스-크롬-입력-검증-및-알림-다이얼로그-프리징)
7. [사례 7: 존재(Existence)만 검증하고 기능성(Playability)을 놓친 QA/QC의 맹점 (Verification Gap)](#사례-7-존재existence만-검증하고-기능성playability을-놓친-qaqc의-맹점)
8. [사례 8: 60Hz 루프 내 객체 생성으로 인한 GC 스터터링 방지 (Zero-GC Breaches)](#사례-8-60hz-루프-내-객체-생성으로-인한-gc-스터터링-방지)

---

## 사례 1: 포탑 사거리 직접 중첩 및 라인전 즉각 붕괴 결함

### 1. 현상 (Symptom)
- 사용자가 게임에 접속하여 미드 라인에 진입하자마자 양측 외곽 1차 타워가 동시에 레이저를 발사함.
- 미니언이 라인 중앙에 도착하자마자 양측 타워의 교차 포격에 10초 만에 전멸함.
- 1레벨 챔피언이 안전하게 CS(막타)를 치거나 딜교환을 할 수 있는 공간이 전혀 없었으며, 중앙에 발을 들이는 순간 타워 4발(방당 170 피해)에 즉사하여 라인전 자체가 성립 불가능했음.

### 2. 근본 원인 분석 (RCA - Root Cause Analysis)
- `server/game/GameEngine.js`의 초기 Summoner's Rift 포탑 좌표 설정 오류:
  - 블루 미드 1차 포탑: $(1350, 1850)$, 사거리 $380\text{px}$
  - 레드 미드 1차 포탑: $(1850, 1350)$, 사거리 $380\text{px}$
- **기하학적 직선거리 계산**:
  $$\text{Distance} = \sqrt{(1850 - 1350)^2 + (1350 - 1850)^2} = \sqrt{500^2 + (-500)^2} \approx \mathbf{707.1\text{px}}$$
- **양측 포탑 사거리 합산**:
  $$\text{Combined Range} = 380\text{px} + 380\text{px} = \mathbf{760\text{px}}$$
- **사거리 중첩 오버랩 (Overlap)**:
  $$\text{Overlap} = 760\text{px} - 707.1\text{px} = \mathbf{+52.9\text{px}}$$
- **맵 정중앙 $(1600, 1600)$에서의 타워 거리**:
  $$\text{dist}_{\text{blue}} = \sqrt{(1600-1350)^2 + (1600-1850)^2} \approx \mathbf{353.5\text{px}} \le 380\text{px}$$
- **결과**: 라인 정중앙이 양측 타워의 동시 피격 구역이었으며, 안전한 중립 파밍 지대(Neutral Safe Zone)가 음수($-53\text{px}$) 상태였음.

### 3. 시정 및 재발 방지 조치 (Corrective Actions)
- **포탑 좌표 전면 재배치 (LoL 표준 규격 확립)**:
  - 블루 미드 1차 포탑: $(1350, 1850) \longrightarrow \mathbf{(1050, 2150)}$
  - 레드 미드 1차 포탑: $(1850, 1350) \longrightarrow \mathbf{(2150, 1050)}$
  - 포탑 간 직선거리: $\sqrt{1100^2 + 1100^2} \approx \mathbf{1,555.6\text{px}}$ 확보.
  - 양측 사거리 제외 순수 중립 완충 지대: $1555.6 - 760 = \mathbf{795.6\text{px}}$ 확보.
  - 정중앙 $(1600, 1600)$에서 양측 타워까지 거리: $\mathbf{777.8\text{px}}$ (사거리의 2배 이상 이격되어 완전 안전).
- **공간 기하학 불변식 수립**:
  - 외곽 1차 타워 간 최소 거리 공식: $\text{Distance}(T_1, T_2) \ge 2 \times \text{Range} + 600\text{px} \approx 1,400\text{px} \sim 1,600\text{px}$.

---

## 사례 2: 1v1 모드 기본 선택 트랩 및 5초 넥서스 단거리 맵 문제

### 1. 현상 (Symptom)
- 사용자가 웹사이트에 접속하여 "+ 방 만들기" $\to$ "생성하기"를 누르면 소환사의 협곡(5v5)이 아니라 좁은 단일 라인(ARAM)으로 강제 진입함.
- 한 화면 안에 블루 넥서스부터 레드 넥서스까지 전 맵이 다 보였으며, 넥서스에서 단 5초만 걸어가면 적 넥서스에 도달하는 유치한 미니 경기장이 표출됨.
- 블루 타워($x=950$)와 레드 타워($x=1450$) 간 거리가 $500\text{px}$에 불과하여 **$260\text{px}$의 극심한 사거리 중첩** 발생.

### 2. 근본 원인 분석 (RCA)
- `public/index.html`에서 `<input type="radio" name="roomMode" value="1v1" checked>`로 하드코딩되어 기본값이 1v1이었음.
- `GameEngine.js`에서 `mode === '1v1'`이면 `isSummonersRift = false`로 판정하여 2400x1600 단일 라인 맵을 로드함.
- 1v1 맵 자체의 구조물 배치도 타워 간 거리 $500\text{px}$로 사거리($760\text{px}$)보다 훨씬 짧게 설계되어 있었음.

### 3. 시정 및 재발 방지 조치
- `public/index.html` 모달의 기본 라디오 선택을 `value="5v5"`(소환사의 협곡)로 변경.
- 대기실 툴바에 **"⚡ 1인 연습 모드 (협곡 즉시 시작)"** 원클릭 바로가기 버튼 추가.
- 1v1 결투 모드 맵 자체도 블루 1차 $x=650$, 레드 1차 $x=1750$으로 재조정하여 거리 $1,100\text{px}$, 중앙 완충 지대 $340\text{px}$를 확보.

---

## 사례 3: 공중에 뜬 금속 드럼통과 빨간 원뿔 드래곤 그래픽스 참사

### 1. 현상 (Symptom)
- [gameplay_08_river_scuttle.png](file:///C:/Users/SSAFY/.gemini/antigravity/brain/95e77a3f-c63f-4155-aed4-98024b8fb7de/gameplay_08_river_scuttle.png) 캡처 결과:
  - 협곡의 바위벽이 짙은 회색의 공중에 뜬 원기둥 금속 드럼통(`CylinderGeometry`)으로 표현됨.
  - 원소 드래곤이 회색 직육면체 상자 뒤에 갇혀 있는 **빨간색 교통 안전 원뿔(`ConeGeometry`)**로 서 있음.
  - 타워는 바닥 노란 원 위에 붕 떠서 도는 단순 다이아몬드(팔면체)였으며, 맵 외곽은 칠흑 같은 검은 공허(Void)였음.

### 2. 근본 원인 분석 (RCA)
- 초기 프로토타입 작성 당시 기능 확인용으로 임시 생성했던 기본 3D 기하학 도형(`CylinderGeometry`, `BoxGeometry`, `ConeGeometry`)을 교체하지 않고 방치함.
- V-모델에서 수치적 단위 테스트만 반복하고, 실제 렌더링된 뷰포트를 시각적으로 확인하는 절차를 생략함.

### 3. 시정 및 재발 방지 조치
- **3D 절벽 지형(Cliff Walls)**: 드럼통/박스를 철거하고, 상단 잔디 베벨과 각진 암벽(Faceted Low-Poly Stone)으로 구성된 3D 단애 절벽 메쉬로 교체.
- **3D 원소 드래곤(Elemental Dragon)**: 원뿔 대신 날개, 뿔, 비늘 융기선, 꼬리를 갖춘 3D 드래곤 보스 조형물 및 둥지(Pit) 지형 구축.
- **3D 석조 포탑**: 다단 팔각 석조 기단, 룬 각인 기둥, 부유하는 아케인 에너지 수정, 동적 조준 레이저 결합.
- **배경 마감**: 맵 외곽에 원경 산악 계곡 지형과 계곡 높이 안개(`FogExp2`)를 적용하여 검은 공허 전면 제거.

---

## 사례 4: MeshToonMaterial 미정의 프로퍼티로 인한 콘솔 경고 폭발

### 1. 현상 (Symptom)
- 브라우저 콘솔에 매 렌더 프레임마다 수십 회씩 아래 경고가 지속 발생하여 디버깅 로그를 뒤덮고 렌더링 성능을 저하시킴:
  ```
  [Browser warning] THREE.Material: 'rimStrength' is not a property of THREE.MeshToonMaterial.
  [Browser warning] THREE.Material: 'rimColor' is not a property of THREE.MeshToonMaterial.
  ```

### 2. 근본 원인 분석 (RCA)
- `public/js/nprMaterial.js`의 `createChampionMaterial` 함수에서 `new THREE.MeshToonMaterial({ ...options })`로 options 객체를 그대로 전달함.
- `MeshToonMaterial` 생성자는 자신이 지원하지 않는 커스텀 uniform 속성(`rimStrength`, `rimColor`, `rimPower`)이 들어오면 콘솔 경고를 강제 출력하도록 설계되어 있음.

### 3. 시정 및 재발 방지 조치
- 객체 디스트럭처링을 통해 커스텀 파라미터와 머티리얼 옵션을 완벽히 분리:
  ```javascript
  export function createChampionMaterial(colorHex, emissiveHex = 0x000000, options = {}) {
    const { rimColor, rimPower, rimStrength, ...materialOptions } = options;
    const mat = new THREE.MeshToonMaterial({
      color: colorHex,
      gradientMap: toonRamp,
      emissive: emissiveHex,
      ...materialOptions
    });
    // 커스텀 uniform은 onBeforeCompile 내부에서만 셰이더로 주입
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: new THREE.Color(rimColor || 0xd2e3fc) };
      shader.uniforms.uRimPower = { value: rimPower || 3.2 };
      shader.uniforms.uRimStrength = { value: rimStrength || 0.55 };
      ...
    };
    return mat;
  }
  ```

---

## 사례 5: BufferGeometry.computeBoundingSphere NaN 계산 크래시

### 1. 현상 (Symptom)
- Three.js 내부 지오메트리 컬링 및 바운딩 연산 시 아래의 치명적 예외 로그 발생:
  ```
  [Browser error] THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.
  ```

### 2. 근본 원인 분석 (RCA)
- 일부 맵 장애물 또는 유닛 메쉬 생성 시, 파라미터(`radius`, `height`)가 정의되지 않은(`undefined`) 상태에서 산술 연산($r \times 0.95$)이 수행되어 `NaN`이 생성되었고, 이것이 `CylinderGeometry`의 정점 좌표 버퍼에 기록됨.

### 3. 시정 및 재발 방지 조치
- 모든 지오메트리 팩토리 함수 상단에 엄격한 NaN 가드 및 기본값 폴백(`const r = obs.radius || 42`, `const h = obs.height || 75`) 강제.
- Inverted Hull 외곽선 생성 시 원본 메쉬의 지오메트리 정상성 검증 추가.

---

## 사례 6: 헤드리스 크롬 입력 검증 및 알림 다이얼로그 프리징

### 1. 현상 (Symptom)
- CDP(Chrome DevTools Protocol) 기반 자동 플레이 테스트 실행 중, 로그인 화면 또는 방 생성 화면에서 브라우저가 영구 블로킹(무한 대기)에 빠짐.

### 2. 근본 원인 분석 (RCA)
- `alert()` 함수가 호출될 경우, 헤드리스 크롬의 메인 스레드가 모달 다이얼로그 확인 응답을 기다리며 모든 비동기 작업을 중단시킴.
- HTML5 폼 유효성 검사(`required`)가 합성 이벤트(`requestSubmit()`)에서 실패하여 서버 요청 패킷이 전송되지 않음.

### 3. 시정 및 재발 방지 조치
- CDP 웹소켓 핸들러에 `Page.javascriptDialogOpening` 리스너를 등록하여 알림창 발생 시 `Page.handleJavaScriptDialog({ accept: true })`로 0.1초 내 자동 수락 처리.
- 폼 입력 자동화 시 하드웨어 수준의 마우스 클릭(`Input.dispatchMouseEvent`) 및 키보드 입력(`Input.dispatchKeyEvent`) 디스패치를 적용하여 실제 사용자 조작과 100% 동일한 입력 흐름 구현.

---

## 사례 7: 존재(Existence)만 검증하고 기능성(Playability)을 놓친 QA/QC의 맹점

### 1. 현상 (Symptom)
- `test/qa_suite.js`의 24개 테스트 항목이 모두 100% PASS였으나, 실제 인간 플레이어가 접속했을 때는 라인전 타워 사거리 중첩으로 게임을 전혀 진행할 수 없었음.

### 2. 근본 원인 분석 (RCA)
- 기존 QC 테스트 코드가 **"데이터 객체가 메모리에 존재하는가"**만을 단언(Assert)하고 있었음:
  ```javascript
  // 맹점: 타워가 존재하고 사거리가 380인지만 검사함 (두 타워가 서로 겹치는지는 검사 안 함)
  expect(structures.blue_mid_outer_turret.range).toBe(380);
  expect(structures.blue_mid_outer_turret.isAlive).toBe(true);
  ```
- 소프트웨어 단위 테스트는 통과했지만, 전장 물리 및 게임 룰 관점에서의 **"기능성(Playability)"**과 **"공간적 불변식(Spatial Invariants)"** 검증이 완전히 누락됨.

### 3. 시정 및 재발 방지 조치
- QC 테스트 스위트에 **공간 기하학 및 동적 라인전 검증 항목**을 의무 추가:
  ```javascript
  // 1. 대치 외곽 타워 간 안전 거리 검증
  const dMid = Math.hypot(redMid.x - blueMid.x, redMid.y - blueMid.y);
  expect(dMid).toBeGreaterThanOrEqual(1400); // 1555.6px 검증

  // 2. 맵 정중앙(미니언 충돌 지점) 중립 완충 구역 검증
  const dCenterBlue = Math.hypot(1600 - blueMid.x, 1600 - blueMid.y);
  const dCenterRed = Math.hypot(1600 - redMid.x, 1600 - redMid.y);
  expect(dCenterBlue).toBeGreaterThan(blueMid.range); // 777.8px > 380px 검증
  expect(dCenterRed).toBeGreaterThan(redMid.range);   // 777.8px > 380px 검증
  ```
- CDP 헤드리스 브라우저 무인 플레이 스크립트를 통한 **실제 인게임 화면 캡처 및 시각적验收(Visual Acceptance)** 파이프라인 정립.

---

## 사례 8: 60Hz 루프 내 객체 생성으로 인한 GC 스터터링 방지

### 1. 현상 (Symptom)
- 장시간 플레이 시 약 15~20초 주기로 마이크로 프레임 드랍(Micro-Stutter) 현상이 발생하여 조작감이 끊김.

### 2. 근본 원인 분석 (RCA)
- `requestAnimationFrame` 렌더 루프 및 서버 60Hz 루프 내부에서 좌표 계산 시 `new THREE.Vector3()`, `new THREE.Color()`, 배열 `.filter()`, `.map()`을 매 틱마다 수십 번 호출하여 V8 힙 가비지가 누적되고, 가비지 컬렉터(Major GC)가 동작할 때 스레드가 일시 중단됨.

### 3. 시정 및 재발 방지 조치
- **Zero-GC 아키텍처 원칙 강제**:
  - 모듈 상단에 재사용 임시 변수(`_v1`, `_v2`, `_q1`, `_dummyObj`)를 정적 선언하고 오직 `.set()`, `.copy()` 메서드만 재사용.
  - 배열 필터링 대신 인덱스 기반 `for` 루프 및 고정 크기 풀(Pool) 패턴 채택.
  - QA 정적 분석 도구로 렌더 루프 내 `new` 키워드 존재 여부를 자동 검사.

---

## 🏁 요약 및 권장 엔지니어링 표준

| 결함 영역 | 주요 결함 | 재발 방지 표준 |
| :--- | :--- | :--- |
| **전장 기하학** | 미드 타워 사거리 중첩 (707px vs 760px) | $\text{Distance}(T_1, T_2) \ge 1,400\text{px}$, 중립 완충 지대 $\ge 700\text{px}$ 불변식 강제 |
| **비주얼 에셋** | 원통 드럼통 바위, 빨간 원뿔 드래곤 | 3D 다각면 절벽 메쉬, 3D 드래곤 보스 조형물, 산악 배경 안개 강제 |
| **셰이더 파이프라인** | `MeshToonMaterial` 알 수 없는 속성 경고 | 커스텀 uniform과 Three.js 머티리얼 옵션의 엄격한 분리 |
| **테스트 공학** | 24개 테스트 통과에도 라인전 불능 | 데이터 존재 검증 탈피 $\to$ 공간 기하학 불변식 및 실제 브라우저 무인 캡처 의무화 |
| **메모리 아키텍처** | GC 스터터링 및 프레임 드랍 | 60Hz 루프 내 `new` 일체 금지 (Zero-GC 원칙 준수) |

# 🤝 기여 가이드라인 (Contributing Guidelines for Humans & LLMs)

`Web MOBA` 프로젝트에 오신 것을 환영합니다!  
본 문서는 개발자 및 **AI 코딩 에이전트(LLM)**가 새로운 챔피언, 스킬 매커니즘, 밸런스 패치, 셰이더 및 시각 효과를 안정적이고 일관성 있게 기여할 수 있도록 작성된 종합 지침서입니다.

---

## 🚀 빠른 시작 (Quick Start)

```bash
# 1. 의존성 설치
npm install

# 2. 게임 서버 실행 (포트 3000, LAN IP 자동 탐색)
npm start

# 3. 자동화 QA 테스트 스위트 검증 (19개 전 항목 100% 필수)
npm test
```

---

## 🤖 LLM 에이전트 작업 5대 황금률 (Strict AI Invariants)

AI 코딩 어시스턴트(Claude, GPT, Gemini, Cursor, Copilot 등)는 코드를 생성하거나 수정할 때 다음 5대 불변 규칙을 **절대 위반해서는 안 됩니다**:

1. **Zero-GC 원칙 (렌더 루프 및 서버 틱 내부 객체 생성 금지)**:
   - `requestAnimationFrame` 및 `GameEngine.update()` 내부에서 `new THREE.Vector3()`, `new THREE.Color()`, `new Array()`, 임시 객체 `{}` 생성을 금지합니다.
   - 반드시 모듈 상단에 선언된 정적 캐시 변수(`_v1`, `_v2`, `_q1` 등)를 재사용하세요.
2. **NPR 툰 렌더링 강제 (단독 PBR 실사 머티리얼 금지)**:
   - 캐릭터 및 유닛 메쉬에 `MeshStandardMaterial` 또는 `MeshPhysicalMaterial` 단독 사용을 금지합니다.
   - 반드시 `MeshToonMaterial` + 3단계 그래디언트 맵 + 림 라이트 셰이더 청크 + 인버티드 헐 외곽선을 적용하세요.
3. **타격감 안정성 (카메라 진동 규칙)**:
   - 일반 평타 및 미니언 전투에서는 카메라 셰이크를 절대 트리거하지 마세요.
   - 치명타 및 궁극기 킬에만 비선형 트라우마($Trauma \in [0, 1]$, 감쇠 $Trauma^2$)를 부여하며, 화면 롤링(`maxShakeRoll`)은 항상 `0.0`을 유지하세요.
4. **구조물 물리 충돌 및 미니언 AI**:
   - 미니언이 포탑/넥서스 내부로 파고들지 않도록 하드 충돌 밀어내기(Pushback) 및 포탑 우회 조향(Flank Steering)을 유지하세요.
5. **UI DOM ID 보존**:
   - `public/index.html`에 정의된 기존 HUD 요소 ID(`hud-slot-q`, `hud-hp-fill`, `hud-minimap-container` 등)를 임의로 변경하거나 삭제하지 마세요.

---

## 🦸‍♂️ 신규 챔피언 추가 파이프라인 (Champion Addition Recipe)

새로운 챔피언을 추가할 때는 다음 3개 파일을 순서대로 수정합니다:

### 1단계: 챔피언 스탯 및 스킬 정의 (`server/game/ChampionData.js`)
`CHAMPIONS` 객체에 고유 `id`를 키로 하여 데이터를 등록합니다:

```javascript
my_champion: {
  id: 'my_champion',
  name: '신규 챔피언 이름',
  title: 'The Title',
  role: '전사', // 역할군: 전사, 원거리 딜러, 마법사, 암살자, 탱커, 서포터
  color: '#3498db',
  accentColor: '#2980b9',
  avatar: '⚡',
  stats: {
    maxHp: 650,
    hpRegen: 3.5,
    maxMp: 320,
    mpRegen: 5.0,
    attackRange: 140,
    attackDamage: 68,
    attackSpeed: 0.75,
    moveSpeed: 310,
    armor: 35,
    magicResist: 32,
    radius: 26
  },
  passive: {
    name: '패시브 이름',
    desc: '패시브 메커니즘 상세 설명'
  },
  skills: {
    Q: { name: 'Q 스킬명', key: 'Q', type: 'skillshot_projectile', cooldown: 6.0, mana: 40, damage: 85, range: 450, radius: 16, desc: '...' },
    W: { name: 'W 스킬명', key: 'W', type: 'aoe_circle', cooldown: 9.0, mana: 50, damage: 110, radius: 220, desc: '...' },
    E: { name: 'E 스킬명', key: 'E', type: 'dash_self', cooldown: 11.0, mana: 60, distance: 300, shield: 120, desc: '...' },
    R: { name: 'R 스킬명', key: 'R', type: 'ultimate_nuke', cooldown: 55.0, mana: 100, damage: 320, range: 600, radius: 200, desc: '...' }
  }
}
```

### 2단계: 서버 엔진 스킬 실행 로직 (`server/game/GameEngine.js`)
`executeSkill(p, key, skill, tx, ty)` 내부의 챔피언 분기에 스킬 효과를 구현합니다:
* **투사체 생성**:
  ```javascript
  this.spawnProjectile({
    ownerId: p.id,
    team: p.team,
    type: `${p.champId}_q`,
    x: p.x,
    y: p.y,
    targetX: tx,
    targetY: ty,
    speed: 650,
    radius: skill.radius || 15,
    damage: skill.damage,
    range: skill.range,
    ccType: 'slow',
    ccDuration: 1.5
  });
  ```
* **즉발 광역 폭발(AoE)**:
  ```javascript
  this.createAoeBlast(p.id, p.team, tx, ty, skill.radius, skill.damage, 'knockup', 0.8);
  ```

### 3단계: 클라이언트 아바타 및 VFX 구현 (`public/js/renderer.js`)
챔피언 고유의 3D 메쉬 외형, 인버티드 헐 외곽선, 스킬 발사 이펙트를 등록합니다.

---

## 🧪 자동화 검증 절차 (Verification Checklist)

모든 코드 기여 전후에 반드시 아래 체크리스트를 통과해야 합니다:

1. **자동화 QA 테스트**:
   ```bash
   node test/qa_suite.js
   ```
   - 19개 전 항목 100% PASS 확인
2. **REST API 상태 점검**:
   - `http://localhost:3000/api/server-info` HTTP 200 OK
   - `http://localhost:3000/api/game-data` 스키마 무결성
3. **가비지 컬렉션 점검**:
   - `requestAnimationFrame` 및 서버 60Hz 틱 루프 내부 `new` 키워드 부재 확인
4. **브라우저 콘솔 무결성**:
   - Uncaught ReferenceError, 404 리소스 누락 제로

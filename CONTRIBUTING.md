# 🤝 기여 가이드라인 (Contributing Guidelines)

`Web MOBA` 프로젝트에 관심을 가져주셔서 감사합니다!  
이 프로젝트는 누구나 자유롭게 새로운 챔피언, 스킬 매커니즘, 밸런스 조정, 그래픽 효과를 개선할 수 있는 열린 오픈소스 프로젝트입니다.

---

## 🛠️ 개발 환경 설정 (Development Setup)

1. 저장소를 Fork 후 로컬에 클론합니다:
   ```bash
   git clone https://github.com/iamywl/Web_game.git
   cd Web_game
   ```
2. 패키지를 설치합니다:
   ```bash
   npm install
   ```
3. 개발 서버를 구동합니다:
   ```bash
   npm start
   ```
4. 브라우저에서 `http://localhost:3000`으로 접속하여 테스트합니다.

---

## 🦸‍♂️ 새로운 챔피언 추가하는 방법 (How to Add a Champion)

새로운 챔피언을 추가하려면 다음 단계를 따릅니다:

### 1단계: 챔피언 스탯 및 스킬 정의 (`server/game/ChampionData.js`)
`CHAMPIONS` 객체에 고유한 `id`로 새 챔피언 데이터를 추가합니다:

```javascript
my_champion: {
  id: 'my_champion',
  name: '신규 챔피언 이름',
  title: 'The Title',
  role: '역할군 (전사 / 마법사 등)',
  color: '#hexcode',
  accentColor: '#hexcode',
  avatar: '🛡️',
  stats: {
    maxHp: 600,
    hpRegen: 3.0,
    maxMp: 300,
    mpRegen: 5.0,
    attackRange: 150,
    attackDamage: 65,
    attackSpeed: 0.75,
    moveSpeed: 300,
    armor: 30,
    magicResist: 30,
    radius: 26
  },
  passive: {
    name: '패시브 스킬명',
    desc: '패시브 효과 설명'
  },
  skills: {
    Q: { name: '스킬명', key: 'Q', type: 'dash_line', cooldown: 6.0, mana: 40, damage: 80, range: 350, desc: '...' },
    W: { name: '스킬명', key: 'W', type: 'aoe_circle', cooldown: 8.0, mana: 50, damage: 100, radius: 200, desc: '...' },
    E: { name: '스킬명', key: 'E', type: 'self_buff', cooldown: 10.0, mana: 50, shieldAmount: 150, duration: 3.0, desc: '...' },
    R: { name: '스킬명', key: 'R', type: 'target_aoe', cooldown: 50.0, mana: 100, damage: 250, range: 500, radius: 180, desc: '...' }
  }
}
```

### 2단계: 서버 엔진 스킬 로직 구현 (`server/game/GameEngine.js`)
`executeSkill(p, key, skill, tx, ty)` 내부의 챔피언 분기에 새 챔피언 스킬 실행 코드를 추가합니다:
* **논타깃 투사체**: `this.spawnProjectile({ ... })`
* **광역 장판기**: `this.aoeZones.push({ ... })`
* **즉발 광역 폭발**: `this.createAoeBlast(p.id, p.team, p.x, p.y, radius, damage, ccType)`

### 3단계: 렌더러 아바타 및 VFX 추가 (`public/js/renderer.js`)
`drawChampionAvatar(ctx, p, teamColor)` 함수 안에 챔피언의 시그니처 무기나 아우라 그리기 코드를 추가합니다.

---

## 🧪 자동화 테스트 검증 (Running Tests)

PR을 제출하기 전에 반드시 전체 QA 테스트가 통과하는지 확인하세요:

```bash
# QA 자동화 테스트 스위트 실행
node test/qa_suite.js
```

모든 테스트 항목(19/19)이 `[PASS]`를 기록해야 합니다.

---

## 📋 커밋 및 풀 리퀘스트 규칙 (Pull Request Guidelines)

* **커밋 메시지 규칙**: Conventional Commits 스타일을 권장합니다.
  * `feat: Add new champion Thunder Mage`
  * `fix: Resolve projectile collision at map boundary`
  * `docs: Update architecture diagram in docs`
  * `perf: Optimize 60 FPS particle pooling`
* **코드 스타일**: 가독성 높고 주석이 풍부한 클린 코드를 지향합니다.
* **오프라인 원칙**: 외부 CDN이나 웹 폰트 등 인터넷 연결이 필요한 외부 의존성을 추가하지 마세요. (폐쇄망 LAN 지원 원칙)

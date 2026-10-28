# 📡 API 및 네트워크 프로토콜 명세 (API & Protocol Specification)

본 문서는 **Web MOBA**의 Express 기반 REST API 및 Socket.IO 실시간 패킷 프로토콜 명세를 상세히 기술합니다.

---

## 1. RESTful HTTP API

### 1.1 서버 상태 및 사설망 IP 조회
* **엔드포인트**: `GET /api/server-info`
* **설명**: 서버 정상 가동 여부 및 로컬 네트워크(LAN) 자동 감지 IP를 반환합니다.
* **응답 예시**:
```json
{
  "status": "online",
  "port": 3000,
  "lanIp": "192.168.42.82",
  "activeRooms": 1,
  "connectedPlayers": 4,
  "serverTime": 1728812345678
}
```

### 1.2 전체 챔피언 및 스킬 메타데이터 조회
* **엔드포인트**: `GET /api/game-data`
* **설명**: 10종 챔피언 기본 스탯, 40개 QWER 스킬, 소환사 주문 메타데이터를 반환합니다.
* **응답 예시**:
```json
{
  "champions": {
    "blademaster": { "id": "blademaster", "name": "검객", "role": "전사", "skills": { ... } },
    "sniper": { "id": "sniper", "name": "저격수", "role": "원거리 딜러", "skills": { ... } }
  },
  "summonerSpells": {
    "flash": { "id": "flash", "name": "점멸", "cooldown": 45 },
    "ignite": { "id": "ignite", "name": "점화", "cooldown": 35 }
  }
}
```

---

## 2. Socket.IO 실시간 프로토콜 라이프사이클

### 2.1 클라이언트 송신 패킷 (Client ➔ Server)

| 이벤트 이름 | 페이로드 스키마 | 설명 |
| :--- | :--- | :--- |
| `registerNickname` | `{ nickname: string }` | 로비 접속 및 닉네임 등록 (최대 12자) |
| `createRoom` | `{ roomName: string, maxPlayers: number }` | 1v1 / 2v2 / 5v5 대전 방 생성 |
| `joinRoom` | `{ roomId: string }` | 기존 대기방 입장 |
| `leaveRoom` | `{}` | 대기방 퇴장 및 로비 복귀 |
| `toggleReady` | `{}` | 대기방 준비 상태 토글 |
| `startDraft` | `{}` | 방장이 밴픽(DRAFT) 단계 시작 요청 |
| `lockChampion` | `{ championId: string, spellD?: string, spellF?: string }` | 챔피언 독점 락인 확정 (원자적 검증) |
| `playerMove` | `{ x: number, y: number }` | 우클릭 이동 목표 좌표 전송 |
| `castSkill` | `{ key: 'Q'\|'W'\|'E'\|'R'\|'D'\|'F', tx: number, ty: number }` | 스킬/주문 스마트키 즉시 시전 |
| `upgradeSkill` | `{ key: 'Q'\|'W'\|'E'\|'R' }` | 스킬 레벨업 ([▲] 버튼 또는 Ctrl+스킬키) |
| `startRecall` | `{}` | 본진 귀환 집중 시작 (8.0초 채널링 [B]) |
| `buyItem` | `{ itemId: string }` | 본진 우물 내 헥스테크 상점 아이템 구매 |
| `sellItem` | `{ slotIndex: number }` | 보유 아이템 70% 가격 환급 판매 |
| `placeWard` | `{ x: number, y: number }` | 4번 장신구 투명 와드 설치 (시야 300px 제공) |
| `chatMessage` | `{ text: string }` | 로비 또는 인게임 채팅 전송 |

---

### 2.2 서버 수신 패킷 (Server ➔ Client)

| 이벤트 이름 | 페이로드 스키마 | 설명 |
| :--- | :--- | :--- |
| `lobbyUpdate` | `{ rooms: RoomInfo[], onlineCount: number }` | 로비 방 목록 및 접속자 수 브로드캐스트 |
| `roomStateUpdate` | `{ room: RoomDetail }` | 방 참가자 명단, 블루/레드 팀 구성, 준비 상태 |
| `draftUpdate` | `{ lockedChampions: string[], rosters: object }` | 실시간 픽 상태 및 비활성화 챔피언 갱신 |
| `draftCountdown` | `{ seconds: number }` | 전원 락인 완료 후 게임 시작 카운트다운 (3초) |
| `gameStart` | `{ mapWidth: 2400, mapHeight: 1600, me: PlayerObj }` | 인게임 씬 전환 및 플레이어 인스턴스 초기화 |
| `gameTick` | `GameTickPayload` (하단 참조) | 60Hz 실시간 동기화 스냅샷 |
| `combatEvent` | `{ type: string, x: number, y: number, damage?: number }` | 피격 플래시, 파티클 이펙트 브로드캐스트 |
| `killAlert` | `{ killer: string, victim: string, isFirstBlood: bool }` | 킬 알림 배너 및 사운드 트리거 |
| `gameOver` | `{ winnerTeam: 'BLUE'\|'RED', reason: string }` | 넥서스 파괴 또는 기권 승패 모달 출력 |

---

### 2.3 60Hz `gameTick` 패킷 스키마

```json
{
  "t": 1728812345678,
  "gameTime": 142.5,
  "score": { "blue": 3, "red": 2 },
  "players": [
    {
      "id": "socket_abc",
      "team": "BLUE",
      "champId": "blademaster",
      "x": 1050.2,
      "y": 780.0,
      "vx": 120.5,
      "vy": -30.2,
      "angle": 1.57,
      "hp": 580,
      "maxHp": 640,
      "mp": 240,
      "maxMp": 300,
      "shield": 50,
      "isDead": false,
      "respawnTimer": 0,
      "level": 6,
      "exp": 180,
      "maxExp": 680,
      "skillPoints": 1,
      "skillRanks": { "Q": 3, "W": 1, "E": 1, "R": 1 },
      "items": ["dorans_blade", "berserkers_greaves"],
      "recalling": false,
      "recallProgress": 0,
      "inBush": false,
      "wardCooldown": 0,
      "dragonBuffStacks": 1,
      "cd": { "Q": 0, "W": 4.2, "E": 0, "R": 42.0, "D": 0, "F": 12.5 }
    }
  ],
  "jungleMonsters": [
    { "id": "scuttle_crab", "name": "바위게", "type": "scuttle", "x": 1200, "y": 800, "hp": 1200, "maxHp": 1200, "isAlive": true },
    { "id": "elemental_dragon", "name": "원소 드래곤", "type": "dragon", "x": 1200, "y": 1350, "hp": 4500, "maxHp": 4500, "isAlive": true }
  ],
  "wards": [
    { "id": "ward_1", "team": "blue", "x": 1150, "y": 720, "radius": 300, "duration": 85 }
  ],
  "projectiles": [
    {
      "id": "proj_12",
      "type": "sniper_q",
      "team": "BLUE",
      "x": 1120.0,
      "y": 780.0,
      "radius": 14,
      "angle": 0.0
    }
  ],
  "minions": [
    {
      "id": "m_blue_1",
      "team": "BLUE",
      "type": "melee",
      "x": 1240.5,
      "y": 800.0,
      "hp": 477,
      "maxHp": 477,
      "angle": 0.0,
      "targetId": "m_red_1"
    }
  ],
  "turrets": [
    {
      "id": "turret_blue_t1",
      "team": "BLUE",
      "x": 700,
      "y": 800,
      "hp": 2500,
      "maxHp": 2500,
      "targetId": "m_red_1",
      "laserProgress": 0.4
    }
  ]
}
```

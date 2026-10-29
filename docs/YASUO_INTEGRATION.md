# 야스오 독립 캐릭터 적용

`yasuo`를 12번째 캐릭터로 추가했습니다. 기존 검객 `blademaster`, 가렌 `garen`과 별도로 선택합니다. 기존 10종 ChampionData 정의는 HEAD와 동일함을 확인했습니다.

## 조작

- 지면 우클릭: 이동. 적 우클릭: 추적 및 근접 평타. 원본 걷기와 4종 평타 동작을 재생합니다.
- Q: 커서 방향 찌르기. 2회 적중으로 중첩을 쌓으면 다음 Q는 관통 회오리이며 적 챔피언을 공중에 띄웁니다. 중첩은 마지막 적중 후 6초 유지합니다.
- W: 커서 방향에 4초간 투사체 차단 장막. 아군 탄환, 포탑 공격, 근접 공격은 통과합니다.
- E: 적 챔피언·미니언·몬스터 위에 커서를 두고 사용. 대상을 관통하며 같은 대상에는 랭크에 따라 10~6초간 다시 사용할 수 없습니다. E 도중 Q는 도착 지점의 원형 공격으로 바뀝니다.
- R: **6레벨 이후 습득**, 공중에 뜬 적 챔피언 위에 커서를 두고 사용. 대상으로 이동해 주변 공중의 적을 붙잡고 1초 후 피해를 줍니다. 지상 대상/범위 밖/미습득 요청은 쿨타임을 소비하지 않습니다.
- 스킬은 Ctrl+Q/W/E/R 또는 HUD의 ▲로 습득합니다. HUD 스킬 클릭 후 지면/대상 클릭도 지원합니다. 마나 대신 기류와 Q 중첩을 표시합니다.

## 구현 범위

설치된 기본 스킨에서 모델·텍스처·13개 애니메이션, 17개 이펙트 텍스처, 17개 효과음을 추출했습니다. 원본 클라이언트 코드가 아니라 `YasuoMechanics.js`의 서버 판정과 Three.js/WebAudio 재생을 새로 구현했습니다. 이벤트 수락 이후 모델·이펙트·사운드를 함께 재생하며 사망, 취소, 경기 종료, 재선택 시 정리합니다.

Q 중첩/관통 회오리, W의 연속 구간 투사체 충돌, E 대상별 재사용 제한/E-Q, 공중 대상 R, 이동 기류/보호막, 아이템 치명타 배율을 구현했습니다. 원작과 완전히 동일한 밸런스·모든 상호작용을 주장하지 않습니다. 피해 계수·기류·시전 시간은 로컬 근사치이며 원본 Wwise 버스, 파티클 실행 그래프, 사망/감정 표현 클립, R 후 추가 방어구 관통은 포함하지 않습니다. 현재 공중 제어는 챔피언 대상으로 적용되며 미니언/몬스터는 Q 피해만 받습니다.

주요 로컬 수치: Q 피해 20×랭크+1.05AD, 사거리475, 공속에 따라 재사용4~1.33초. 회오리 범위1200/속도1200, 챔피언 공중1초. W 폭300~500, 재사용25~17초. E 0.25초/475거리, 재사용0.5~0.1초. R 범위1400, 피해100+100×랭크+1.5AD, 재사용70/50/30초. 기류 보호막은100+20×(레벨−1), 1초입니다.

## 프로토콜

기존 `castSkill {key,targetX,targetY,targetId}`를 사용합니다. E/R은 클라이언트 커서 선택과 서버의 생존·팀·거리·시야·공중 조건 검사를 모두 거칩니다.

- `yasuoSkill {playerId,key,phase,variant,x,y,targetX,targetY,targetId,duration,angle,radius}`: phase는 cast/hit/end. variant는 thrust/tornado/circle/wall/dash/ultimate/shield.
- `yasuoWallBlock {playerId,wallId,x,y}`: 적 투사체 차단 효과와 사운드.
- `player.yasuo`: qStacks, qRemaining, eRemaining, rRemaining, flow, shieldRemaining. 타 캐릭터는 null.
- `player.airborneRemaining`: R 대상 선택용 공중 시간.
- `gameTick.yasuoWalls`: id/playerId/team/x/y/angle/width/remaining.
- `projectiles`: ownerId와 `type: yasuo_tornado`. 벽·회오리는 스냅샷 ID로 재사용/제거하여 중복 생성하지 않습니다.

## 검증 — 2026-10-29

- `node test/qa_suite.js`: 실제 서버의 공통 통합 **25/25 PASS**.
- `node --test test/yasuo_skills_test.js`: 야스오 이동/평타/QWER/E-Q/정글 대상/기류/거절/사망 **14/14 PASS**.
- `node --test test/garen_skills_test.js test/garen_snapshot_test.js`: 가렌·검객 회귀 **28/28 PASS**.
- `node test/garen_socket_test.js`: 실제 서버에서 검객·가렌 동시 선택 및 스킬 독립성 **11/11 PASS**.
- `test/yasuo_animation.html`: 실제 WebGL 스키닝, 독립 복제, 13클립, 17텍스처, 17개 WebAudio 디코딩/실제 PCM 출력, 음소거·정리·벽/회오리 수명 **71/71 PASS**. 보고서: `test/yasuo-animation-report.json`.
- `test/yasuo_browser_test.js`: 실제 게임 화면의 로그인→방→밴픽→야스오 선택→우클릭 이동/평타→W→Q 두 번→Q3 공중→R→E/대상 재사용 제한 **12/12 PASS**, 페이지·리소스 오류0. `test/yasuo-results/browser-match.json`, `match-wall.png`, `match-ultimate.png`.

마지막 검사는 `node test/serve_yasuo_match.js`의 4176 테스트 서버에서 6레벨·시작 위치·튼튼한 정지 상대를 준비하고 라인 AI만 비활성화했습니다. 실제 클라이언트의 마우스/키보드, Socket.IO 핸들러, 60Hz 엔진을 통과합니다. 운영 서버에는 테스트 엔드포인트/치트를 추가하지 않았습니다. 일반 서버는3000, 리소스 검증 서버는4175입니다. 테스트 서버는 자동 플레이를 마친 후 종료했습니다.

브라우저 테스트에는 `playwright-core`와 Chrome이 필요합니다. 이 PC에서는 `PLAYWRIGHT_MODULE`에 설치된 REA의 playwright-core 경로를 지정했습니다. 테스트는 렌더러·이벤트 관찰만 추가하며 스킬 상태나 입력 처리 코드를 바꾸지 않습니다. 전 구간 실제 대전, 모든 캐릭터 조합, 장시간 성능은 별도 검증 범위입니다.

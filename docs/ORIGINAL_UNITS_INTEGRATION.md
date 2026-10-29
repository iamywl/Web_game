# 원본 미니언·포탑 적용

## 적용 범위

설치된 `Map11.wad.client`에서 원본 모델·텍스처·뼈대 애니메이션을 추출해 기존 게임에 연결했습니다. 캐릭터 선택 목록과 검객/가렌/야스오, 맵·피해·AI·충돌·웨이브·보상 규칙은 유지합니다.

| 대상 | 리소스 | 연결된 상태 |
|---|---|---|
| 블루/레드 근접·원거리·대포·슈퍼 미니언 | 8 GLB, 원본 텍스처, 총55개 원본 클립 | 대기, 이동, 공격 변형, 사망 |
| 블루 OrderBlue 포탑 | 58뼈대, 5클립 | 원본 정상 외형, break3 파괴, 잔해 |
| 레드 ChaosRed 포탑 | 82뼈대, 8클립 | 별도 원본 외형·깃발, break3 파괴, 잔해 |

레드 포탑은 블루 모델의 색상 변경이 아니라 원본 ChaosRed 모델입니다. 미니언의 원본 공유 애니메이션 참조는 skin/animation BIN의 WAD 경로 해시와 대조했습니다. 포탑의 정상/파괴 파트는 원본 애니메이션 그래프와 파편 정의를 해석했습니다.

포탑에는 전용 발사 뼈대 클립이 없습니다. 따라서 기존 실제 투사체·조준선으로 공격을 표시합니다. 원본 파괴 `break3`를 웹에서2.2초로 압축하고, 종료 시 `Rubble`(레드에는 `RubbleBase`도 포함)만 남깁니다. 원본 파티클 그래프나 포탑 피해 단계별 전환 전체를 실행하지는 않습니다. 넥서스·억제기·지형·사운드는 이번 적용 대상이 아닙니다.

## 연결과 기능 보존

- `public/js/unitModels.js`: GLB 캐시, 독립 스켈레톤/재질 복제, 텍스처 기반 툰/림/스키닝 외곽선, 상태별 클립 선택, 해제.
- `renderer.js`: 기존 미니언/포탑 생성 경로에 비동기 로드. 로드 실패 시 기존 절차형 외형을 유지합니다. 원본 모델이 준비되면 기존 외형만 교체하고 포탑의 사거리·조준·무적 표시는 유지합니다.
- 서버에 추가한 `attackSequence`는 실제 공격이 실행될 때만 증가합니다. 클라이언트는 같은 스냅샷을 여러 프레임 재생해도 공격 동작을 재시작하지 않습니다. 미니언 속도는 모든 충돌/분리 계산 후 측정합니다.
- 미니언 사망 즉시 서버의 공격 대상/HP바/미니맵에서 제외하고, 클라이언트 외형만 원본 사망 클립이 끝날 때까지 유지합니다. 서버의 CS·골드·경험치 시점은 그대로입니다.
- 경기 맵을 다시 설정하면 미니언과 구조물 인스턴스를 해제합니다. 늦게 완료되는 비동기 로드가 이전 경기의 객체에 붙지 않도록 방지합니다. 캐시된 원본 지오메트리·텍스처는 다른 인스턴스가 계속 사용합니다.
- 실제 막타 검사 중 발견한 로컬 플레이어 `cs` 스냅샷 복사 누락을 수정해 기존 HUD의 CS 수치가 갱신되도록 했습니다.
- 현재 게임의 슈퍼 미니언 공격 방식(투사체)은 기존 판정을 유지했습니다. 이번 작업은 원작 전체 규칙의 재구현이 아닙니다.

추가 스냅샷 필드: `structures[].attackSequence`; `minions[].attackSequence/vx/vy/speed/as/targetId`. 기존 필드는 그대로입니다. `visualX/visualY`는 서버 내부 계산용이며 전송하지 않습니다.

## 재현과 검증 — 2026-10-29

리소스별 원본 경로/해시는 `public/assets/units/minions/manifest.json`, `public/assets/structures/turrets/manifest.json`에 있습니다. 추출은 설치 폴더를 읽기만 하며 아래 스크립트가 기존 형제 폴더의 변환 도구를 재사용합니다.

```powershell
python test/export_minions.py
powershell -File test/export_turrets.ps1
node --test test/unit_snapshot_test.js test/garen_skills_test.js test/garen_snapshot_test.js test/yasuo_skills_test.js
node test/qa_suite.js
node test/garen_socket_test.js
```

검증 결과:

- 신규 서버 검사 **11/11 PASS**: 원본 모델용 상태 추가 후에도 실제 피해/쿨타임/타깃·포탑 어그로/무적/충돌/보상/3라인·슈퍼 웨이브 유지.
- 가렌·검객·야스오 엔진 회귀와 합계 **53/53 PASS**.
- 실제3000 서버 공통 QA **25/25 PASS**, 가렌·검객 소켓 회귀 **11/11 PASS**.
- `test/minion_asset_preview.html`: 8개 텍스처,55개 원본 클립의 실제 스킨 정점 변형 확인. `test/export_minions-preview-report.json`.
- `test/unit_models.html`: 실제 게임의 모델 생성·프레임 갱신·해제 경로 **53/53 PASS**. 이동/공격, 복제 독립성, 사망 후 제거, 포탑 파괴/오버레이, 비동기 해제, 같은 ID의 재경기, 셰이더 검증. `test/unit-results/visual.json`.
- `test/unit_browser_test.js`: 실제 브라우저 로그인→밴픽→야스오 선택,8종 모델, AI 이동/공격, 포탑 발사, 우클릭 막타와 HUD CS/골드, 사망 정리, 포탑 파괴·잔해 **10/10 PASS**, JS/리소스/WebGL 오류0. `test/unit-results/browser-match.json`.

실제 경기 검사는 `node test/serve_unit_match.js`(4177)의 테스트 전용 초기 배치를 사용했습니다. 슈퍼·대포를 포함한 유닛, 높은 플레이어 체력, 정지/저체력 막타 대상과 저체력 포탑을 준비했습니다. 이후 입력·AI·피해·보상·통신·화면은 운영 코드로 처리하며 운영 서버에는 테스트 엔드포인트를 추가하지 않았습니다.

뷰어는 `node test/serve_garen_check.js`(4175), 자동 브라우저 검사는 `node test/run_unit_visual_test.js` / `node test/unit_browser_test.js`입니다. Chrome과 `playwright-core`가 필요하며 이 PC에서는 `PLAYWRIGHT_MODULE` 환경변수에 REA에 설치된 playwright-core 경로를 지정했습니다.

초기 모델 로드/셰이더 컴파일 비용은 있으며 장시간 대규모전 성능 전체를 보장하지는 않습니다. 신규 애니메이션 갱신 경로는 프레임마다 지오메트리/재질/벡터 인스턴스를 만들지 않고, 생성·전환·사망·해제 시 작업합니다. 기존 엔진 전체의 Zero-GC를 인증한 것은 아닙니다.

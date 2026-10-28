import * as THREE from 'three';

// Zero-GC를 위한 임시 벡터
const _vServerPos = new THREE.Vector3();
const _vInterpPos = new THREE.Vector3();

export class NetworkManager {
  constructor(socket, gameFeelController, myPlayerId) {
    this.socket = socket;
    this.controller = gameFeelController;
    this.myPlayerId = myPlayerId;

    // 입력 시퀀스 관리
    this.inputSequence = 0;
    this.pendingInputs = []; // [{ seq, targetX, targetZ, dt, timestamp }]

    // 원격 엔티티(다른 챔피언) 스냅샷 버퍼 (타임스탬프 기반 보간용)
    this.remoteSnapshots = new Map(); // entityId -> [{ timestamp, position, angle }]
    this.remoteMeshes = new Map();    // entityId -> THREE.Mesh
    this.interpolationDelay = 66.6;   // 30Hz 기준 약 2틱(66.6ms) 이전 상태 렌더링

    this._initSocketListeners();
  }

  _initSocketListeners() {
    // 30Hz 서버 전체 게임 상태 스냅샷 수신
    this.socket.on('game:snapshot', (snapshot) => {
      this._handleSnapshot(snapshot);
    });

    // 타격 및 스킬 이벤트 수신 (타격감 연출 즉시 트리거)
    this.socket.on('combat:hit', (event) => {
      this._handleCombatEvent(event);
    });
  }

  /**
   * 우클릭 이동 명령 발생 시 호출
   */
  sendMoveCommand(targetX, targetZ) {
    this.inputSequence++;
    const now = performance.now();

    const inputData = {
      seq: this.inputSequence,
      targetX,
      targetZ,
      timestamp: now
    };

    // 1. 로컬 입력 버퍼에 보관
    this.pendingInputs.push(inputData);

    // 2. GameFeelController에 즉시 전달하여 로컬 선행 이동 개시
    this.controller.issueMoveCommand(targetX, targetZ, this.inputSequence);

    // 3. 서버로 전송
    this.socket.emit('player:move', {
      seq: this.inputSequence,
      targetX: Number(targetX.toFixed(2)),
      targetZ: Number(targetZ.toFixed(2)),
      clientTimestamp: now
    });
  }

  /**
   * 30Hz 서버 스냅샷 처리
   */
  _handleSnapshot(snapshot) {
    const { tick, entities, serverTime } = snapshot;
    if (!entities) return;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      if (entity.id === this.myPlayerId) {
        // [내 챔피언]: 서버 권한 판정 오차 보정 (Reconciliation)
        this._reconcileLocalPlayer(entity);
      } else {
        // [다른 챔피언]: 보간 큐에 스냅샷 저장
        this._recordRemoteSnapshot(entity, serverTime || performance.now());
      }
    }
  }

  /**
   * 내 캐릭터 서버 오차 보정 (Server Reconciliation)
   */
  _reconcileLocalPlayer(serverEntity) {
    const lastSeq = serverEntity.lastProcessedSeq || 0;

    // 1. 서버가 이미 처리 완료한 이전 입력 제거
    this.pendingInputs = this.pendingInputs.filter(input => input.seq > lastSeq);

    // 2. 서버가 인정한 확정 위치
    _vServerPos.set(serverEntity.x, this.controller.player.position.y, serverEntity.z);

    // 3. GameFeelController의 서버 상태 동기화 및 잔여 입력 재연(Replay)
    this.controller.onServerReconciliation(_vServerPos, this.pendingInputs);
  }

  /**
   * 원격 엔티티 스냅샷 등록
   */
  _recordRemoteSnapshot(entity, timestamp) {
    if (!this.remoteSnapshots.has(entity.id)) {
      this.remoteSnapshots.set(entity.id, []);
    }

    const buffer = this.remoteSnapshots.get(entity.id);
    buffer.push({
      timestamp,
      position: new THREE.Vector3(entity.x, 0, entity.z),
      angle: entity.angle || 0
    });

    // 버퍼 최적화: 최근 1초(30프레임) 이상 지난 과거 데이터 제거
    while (buffer.length > 30) {
      buffer.shift();
    }
  }

  /**
   * 전투/타격 이벤트 처리 (히트스톱, 피격 플래시, 셰이크 발동)
   */
  _handleCombatEvent(event) {
    const { targetId, damage, isCrit, hitStopDuration = 0.05 } = event;

    // 피격 대상 메쉬 탐색 (본인이거나 원격 플레이어)
    const targetMesh = (targetId === this.myPlayerId)
      ? this.controller.player
      : this.remoteMeshes.get(targetId);

    if (targetMesh) {
      // 1. 피격 플래시 점멸
      this.controller.triggerDamageFlash(targetMesh, 0.08);

      // 2. 강한 공격/크리티컬 적중 시 절제된 히트스톱 (기본 타격 시 화면 흔들림 완전 차단)
      if (isCrit || damage >= 100) {
        this.controller.triggerHitStop(hitStopDuration);
        if (isCrit) {
          this.controller.addTrauma(0.1);
        }
      }
    }
  }

  /**
   * 원격 챔피언 부드러운 위치/회전 보간 (매 렌더링 프레임 60~144Hz 호출)
   */
  updateRemoteEntities(renderDelta) {
    const renderTime = performance.now() - this.interpolationDelay;

    for (const [id, buffer] of this.remoteSnapshots.entries()) {
      const mesh = this.remoteMeshes.get(id);
      if (!mesh || buffer.length < 2) continue;

      let prev = null;
      let next = null;

      for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i].timestamp <= renderTime && renderTime <= buffer[i + 1].timestamp) {
          prev = buffer[i];
          next = buffer[i + 1];
          break;
        }
      }

      if (prev && next) {
        const span = next.timestamp - prev.timestamp;
        const progress = span > 0 ? (renderTime - prev.timestamp) / span : 0;
        const alpha = Math.max(0, Math.min(1, progress));

        _vInterpPos.lerpVectors(prev.position, next.position, alpha);
        mesh.position.x = _vInterpPos.x;
        mesh.position.z = _vInterpPos.z;

        mesh.rotation.y = THREE.MathUtils.lerp(prev.angle, next.angle, alpha);
      } else if (buffer.length > 0) {
        const latest = buffer[buffer.length - 1];
        mesh.position.x = latest.position.x;
        mesh.position.z = latest.position.z;
      }
    }
  }

  registerRemoteMesh(entityId, mesh) {
    this.remoteMeshes.set(entityId, mesh);
  }

  unregisterRemoteMesh(entityId) {
    this.remoteMeshes.delete(entityId);
    this.remoteSnapshots.delete(entityId);
  }
}

if (typeof window !== 'undefined') {
  window.NetworkManager = NetworkManager;
}

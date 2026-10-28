import * as THREE from 'three';

// Zero-GC를 위한 전역 캐시 변수
const _vTarget = new THREE.Vector3();
const _vMoveDir = new THREE.Vector3();
const _qTarget = new THREE.Quaternion();

export class GameFeelController {
  constructor(camera, playerMesh, options = {}) {
    this.camera = camera;
    this.player = playerMesh;

    // 조작감: 이동 및 회전 파라미터
    this.moveSpeed = options.moveSpeed || 340.0; // 유닛/초
    this.turnRate = options.turnRate || (Math.PI * 4.0); // 초당 약 720도 회전
    this.predictedPosition = new THREE.Vector3().copy(playerMesh.position);
    this.destination = new THREE.Vector3().copy(playerMesh.position);
    this.isMoving = false;
    this.walkCycle = 0;

    // 타격감: 히트스톱
    this.hitStopTimer = 0;

    // 타격감: 트라우마 기반 카메라 셰이크
    this.trauma = 0;
    this.baseCameraPos = new THREE.Vector3().copy(camera.position);
    this.shakeDecay = options.shakeDecay || 3.5; // Fast recovery
    this.maxShakeOffset = options.maxShakeOffset || 1.2; // Subtle crisp vibration (LoL style, never disorienting)
    this.maxShakeRoll = 0.0; // Strictly zero roll in isometric MOBA camera

    // 피격 플래시를 위한 오리지널 머티리얼 캐시
    this.flashTimers = new Map(); // mesh -> remaining time
  }

  /**
   * 시작 위치 초기화 (스폰 좌표 세팅)
   */
  initPosition(x, z) {
    this.predictedPosition.set(x, 0, z);
    this.destination.set(x, 0, z);
    this.isMoving = false;
    if (this.player) {
      this.player.position.set(x, 0, z);
    }
  }

  /**
   * 1. 조작감: 우클릭 즉시 로컬 이동 개시 (0ms 인풋 랙)
   */
  issueMoveCommand(targetX, targetZ) {
    this.destination.set(targetX, 0, targetZ);
    this.isMoving = true;

    // 회전 목표 쿼터니언 즉시 계산
    const dx = targetX - this.predictedPosition.x;
    const dz = targetZ - this.predictedPosition.z;
    if (Math.hypot(dx, dz) > 4) {
      const angle = Math.atan2(dz, dx);
      const targetRotY = -angle + Math.PI / 2;
      _vTarget.set(0, 1, 0);
      _qTarget.setFromAxisAngle(_vTarget, targetRotY);
    }
  }

  /**
   * 이동 중지 명령
   */
  stopMoving() {
    this.destination.copy(this.predictedPosition);
    this.isMoving = false;
  }

  /**
   * 서버 권한 스냅샷 수신 시 오차 보정 (Server Reconciliation)
   */
  onServerSnapshot(serverX, serverZ) {
    const errorDist = Math.hypot(this.predictedPosition.x - serverX, this.predictedPosition.z - serverZ);

    if (errorDist > 140.0) {
      // 플래시/순간이동/사망 리스폰 등 거대 오차 발생 시 강제 하드 스냅
      this.predictedPosition.set(serverX, 0, serverZ);
    } else if (errorDist > 2.0) {
      // 롤 스타일 부드러운 수렴 (82% 로컬 예측 유지, 18% 서버 스냅 점진 흡수)
      this.predictedPosition.x = this.predictedPosition.x * 0.82 + serverX * 0.18;
      this.predictedPosition.z = this.predictedPosition.z * 0.82 + serverZ * 0.18;
    }
  }

  /**
   * 2. 타격감: 피격 플래시 트리거 (대상 메쉬를 순간 순백색 점멸 후 감쇠)
   */
  triggerDamageFlash(targetMesh, duration = 0.08) {
    if (!targetMesh) return;

    const targets = [];
    if (targetMesh.material) {
      targets.push(targetMesh);
    } else if (targetMesh.traverse) {
      targetMesh.traverse((child) => {
        if (child.isMesh && child.material && !child.userData.isOutline) {
          targets.push(child);
        }
      });
    }

    for (let i = 0; i < targets.length; i++) {
      const mesh = targets[i];
      if (!mesh.material) continue;

      if (!mesh.userData.origEmissive) {
        mesh.userData.origEmissive = mesh.material.emissive
          ? mesh.material.emissive.clone()
          : new THREE.Color(0x000000);
        mesh.userData.origEmissiveIntensity = mesh.material.emissiveIntensity || 0;
      }

      if (mesh.material.emissive) {
        mesh.material.emissive.setHex(0xffffff);
        mesh.material.emissiveIntensity = 2.5;
        this.flashTimers.set(mesh, duration);
      }
    }
  }

  /**
   * 3. 타격감: 히트스톱 트리거
   */
  triggerHitStop(duration = 0.045) {
    this.hitStopTimer = Math.max(this.hitStopTimer, duration);
  }

  /**
   * 4. 타격감: 트라우마 추가 (카메라 진동 유도)
   */
  addTrauma(amount) {
    this.trauma = Math.min(0.35, this.trauma + amount * 0.25);
  }

  /**
   * 카메라 기준 위치 갱신
   */
  setBaseCameraPos(x, y, z) {
    this.baseCameraPos.set(x, y, z);
  }

  /**
   * 매 렌더링 프레임 갱신 (requestAnimationFrame 내부 호출)
   */
  update(delta) {
    // [히트스톱 감쇠]
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= delta;
    }

    // [피격 플래시 지수 감쇠]
    for (const [mesh, timeLeft] of this.flashTimers.entries()) {
      const nextTime = timeLeft - delta;
      if (nextTime <= 0) {
        if (mesh.material && mesh.material.emissive && mesh.userData.origEmissive) {
          mesh.material.emissive.copy(mesh.userData.origEmissive);
          mesh.material.emissiveIntensity = mesh.userData.origEmissiveIntensity;
        }
        this.flashTimers.delete(mesh);
      } else {
        if (mesh.material) {
          mesh.material.emissiveIntensity = (nextTime / 0.08) * 2.5;
        }
        this.flashTimers.set(mesh, nextTime);
      }
    }

    // [조작감: 이동 및 턴 레이트 회전 보간 (Slerp 720 deg/s)]
    if (this.isMoving) {
      _vMoveDir.subVectors(this.destination, this.predictedPosition);
      _vMoveDir.y = 0;
      const distance = _vMoveDir.length();

      if (distance < 4.0) {
        this.isMoving = false;
        this.predictedPosition.copy(this.destination);
      } else {
        _vMoveDir.normalize();

        // 챔피언 정면(+Z) 기준 쿼터니언 회전 보간
        const angle = Math.atan2(_vMoveDir.z, _vMoveDir.x);
        const targetRotY = -angle + Math.PI / 2;
        _vTarget.set(0, 1, 0);
        _qTarget.setFromAxisAngle(_vTarget, targetRotY);
        this.player.quaternion.rotateTowards(_qTarget, this.turnRate * delta);

        // 예측 위치 이동
        const step = Math.min(distance, this.moveSpeed * delta);
        this.predictedPosition.addScaledVector(_vMoveDir, step);
        this.walkCycle += 0.28;
      }
    }

    // 메쉬 위치 동기화 (자연스러운 걷기 바운스 적용)
    const walkBob = this.isMoving ? Math.sin(this.walkCycle) * 2.5 : 0;
    this.player.position.set(this.predictedPosition.x, walkBob, this.predictedPosition.z);

    // [카메라 셰이크 처리: Trauma^2 비선형 감쇠 진동]
    if (this.trauma > 0) {
      const shakePower = this.trauma * this.trauma;
      const time = performance.now() * 0.045;

      const offsetX = (Math.sin(time * 1.7) * 2 - 1) * this.maxShakeOffset * shakePower;
      const offsetZ = (Math.cos(time * 2.1) * 2 - 1) * this.maxShakeOffset * shakePower;
      const roll = (Math.sin(time * 1.3) * 2 - 1) * this.maxShakeRoll * shakePower;

      this.camera.position.x = this.baseCameraPos.x + offsetX;
      this.camera.position.z = this.baseCameraPos.z + offsetZ;
      this.camera.rotation.z = roll;

      this.trauma = Math.max(0, this.trauma - this.shakeDecay * delta);
    } else {
      this.camera.position.x = this.baseCameraPos.x;
      this.camera.position.z = this.baseCameraPos.z;
      this.camera.rotation.z = 0;
    }
  }
}

// Global Browser Window Exposure
if (typeof window !== 'undefined') {
  window.GameFeelController = GameFeelController;
}

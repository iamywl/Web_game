import * as THREE from 'three';

/**
 * nprMaterial.js
 * Non-Photorealistic Rendering (NPR) & Toon Material Factory
 * Eliminates PBR plastic look and generates League of Legends stylized toon shading with Rim Light & Inverted Hull Outlines.
 */

/**
 * 롤 특유의 3단 명암 램프 텍스처를 동적으로 생성 (Gradient Map)
 */
export function createToonRampTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  // 어두운 영역(30%), 중간 영역(70%), 하이라이트(100%)
  const gradient = ctx.createLinearGradient(0, 0, 4, 0);
  gradient.addColorStop(0.0, '#4d4d4d');
  gradient.addColorStop(0.4, '#b3b3b3');
  gradient.addColorStop(0.8, '#ffffff');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

export const toonRamp = createToonRampTexture();

/**
 * 캐릭터용 NPR 툰 머티리얼 생성기
 * 커스텀 셰이더 청크로 Rim Light(외곽 발광)를 주입하여 배경과 챔피언을 시각적으로 명확히 분리
 */
export function createChampionMaterial(colorHex, emissiveHex = 0x000000, options = {}) {
  const { rimColor, rimPower, rimStrength, ...materialOptions } = options;
  const mat = new THREE.MeshToonMaterial({
    color: colorHex,
    gradientMap: toonRamp,
    emissive: emissiveHex,
    emissiveIntensity: options.emissiveIntensity || 0.0,
    wireframe: false,
    ...materialOptions
  });

  // 커스텀 셰이더 청크: LoL 스타일 림 라이팅 (Rim Lighting) 주입
  const rimColorHex = options.rimColor || 0xd2e3fc;
  const rimExponent = rimPower ?? 3.2;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(rimColorHex) };
    shader.uniforms.uRimPower = { value: rimExponent };
    shader.uniforms.uRimStrength = { value: rimStrength ?? 0.55 };

    shader.fragmentShader = `
      uniform vec3 uRimColor;
      uniform float uRimPower;
      uniform float uRimStrength;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      #include <dithering_fragment>
      // Stylized NPR Rim Light Injection
      vec3 nprNormal = normalize(vNormal);
      vec3 nprView = normalize(vViewPosition);
      float rimFactor = 1.0 - clamp(dot(nprNormal, nprView), 0.0, 1.0);
      float rimTerm = pow(rimFactor, uRimPower) * uRimStrength;
      gl_FragColor.rgb += uRimColor * rimTerm;
      `
    );
  };

  return mat;
}

/**
 * Inverted Hull 기반 카툰 외곽선 메쉬 생성기
 * 정점 노멀 확장 백페이스 렌더링으로 굵고 뚜렷한 손맵 카툰 실루엣 형성
 */
export function createOutlineMesh(sourceMesh, outlineColor = 0x111116, thickness = 0.45) {
  if (!sourceMesh || !sourceMesh.geometry) return null;

  const outlineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uOutlineThickness: { value: thickness },
      uOutlineColor: { value: new THREE.Color(outlineColor) }
    },
    vertexShader: `
      uniform float uOutlineThickness;
      void main() {
        vec3 transformed = position + normal * uOutlineThickness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uOutlineColor;
      void main() {
        gl_FragColor = vec4(uOutlineColor, 1.0);
      }
    `,
    side: THREE.BackSide
  });

  const outlineMesh = new THREE.Mesh(sourceMesh.geometry, outlineMaterial);
  return outlineMesh;
}

// Global Browser Window Exposure
if (typeof window !== 'undefined') {
  window.createToonRampTexture = createToonRampTexture;
  window.toonRamp = toonRamp;
  window.createChampionMaterial = createChampionMaterial;
  window.createOutlineMesh = createOutlineMesh;
}

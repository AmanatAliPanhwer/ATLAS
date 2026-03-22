'use strict';

const DOT_N = 3000;
const SPH_R = 2;
const B_SIZE = 0.058;
const S_FAC = 310;

let currentMode = 'idle';
const sys = { intensity: 0, speaking: 0, listening: 0, rotX: 0.0009, rotY: 0.0024, wIntv: 0.52 };

const initSphere = async () => {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve));
  }

  const canvas = document.getElementById('canvas');
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  const gW = () => window.innerWidth;
  const gH = () => window.innerHeight;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(gW(), gH());
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, gW() / gH(), 0.1, 100);
  camera.position.set(0, 0, 6);

  // ── DOT SPHERE ────────────────────────────────
  const pos = new Float32Array(DOT_N * 3);
  const aSize = new Float32Array(DOT_N);
  const aInten = new Float32Array(DOT_N);
  const phases = new Float32Array(DOT_N);
  const base = [];
  const GA = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < DOT_N; i++) {
      const y = 1 - (i / (DOT_N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const th = GA * i;
      const x = r * Math.cos(th) * SPH_R;
      const yy = y * SPH_R;
      const z = r * Math.sin(th) * SPH_R;
      pos[i * 3] = x; pos[i * 3 + 1] = yy; pos[i * 3 + 2] = z;
      base.push(new THREE.Vector3(x, yy, z));
      phases[i] = Math.random() * Math.PI * 2;
      aSize[i] = B_SIZE;
      aInten[i] = 0.3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aIntensity', new THREE.BufferAttribute(aInten, 1));

  const mat = new THREE.ShaderMaterial({
      vertexShader: `
      attribute float aSize;
      attribute float aIntensity;
      varying float vI;
      uniform float uPR;
      void main(){
        vI = aIntensity;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = aSize * uPR * (${S_FAC}.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
      fragmentShader: `
      uniform vec3  uC1;
      uniform vec3  uC2;
      uniform float uBlend;
      varying float vI;
      void main(){
        vec2  uv = gl_PointCoord - 0.5;
        float d  = length(uv);
        if(d > 0.5) discard;
        float ring = smoothstep(.50,.42,d)*(1.0-smoothstep(.34,.26,d));
        float core = smoothstep(.16,.0,d)*.95;
        float halo = exp(-d*7.5)*.22;
        vec3  col   = mix(uC1,uC2,clamp(uBlend*vI*1.5,0.,1.));
        float alpha = (ring*.9+core+halo)*(.25+vI*.92);
        gl_FragColor = vec4(col,clamp(alpha,0.,1.));
      }
    `,
      uniforms: {
          uC1: { value: new THREE.Color(0xf5c736) },
          uC2: { value: new THREE.Color(0xffd147) },
          uBlend: { value: 0.0 },
          uPR: { value: Math.min(devicePixelRatio, 2) },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  const dots = new THREE.Points(geo, mat);
  scene.add(dots);

  // ── WAVE SYSTEMS ─────────────────────────────
  let waves = [], lastWave = 0;
  function spawnWave() {
      const phi = Math.random() * Math.PI * 2, ct = Math.random() * 2 - 1, st = Math.sqrt(1 - ct * ct);
      waves.push({ ori: new THREE.Vector3(st * Math.cos(phi), ct, st * Math.sin(phi)).normalize(), born: performance.now() / 1000, spd: 1.55 + Math.random() * .95, amp: .13 + Math.random() * .13, life: 2.5 + Math.random() * .5 });
  }

  let voicePulses = [], lastVoicePulse = 0, voiceLon = 0;
  function spawnVoicePulse() {
      voiceLon += 0.41;
      const lat = (Math.random() - .5) * .3;
      voicePulses.push({
          ori: new THREE.Vector3(Math.cos(lat) * Math.cos(voiceLon), Math.sin(lat), Math.cos(lat) * Math.sin(voiceLon)).normalize(),
          born: performance.now() / 1000, spd: 2.4, amp: .11, life: 1.6
      });
  }

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  document.addEventListener('mousemove', e => { mouse.tx = (e.clientX / gW() - .5) * 2; mouse.ty = (e.clientY / gH() - .5) * 2; });

  // ── TICK ──────────────────────────────────────
  let statsT = 0;
  function tick(ts) {
      requestAnimationFrame(tick);
      const t = ts / 1000;

      mouse.x += (mouse.tx - mouse.x) * .042;
      mouse.y += (mouse.ty - mouse.y) * .042;
      camera.position.x = mouse.x * .42;
      camera.position.y = -mouse.y * .26;
      camera.lookAt(scene.position);

      const wGap = sys.wIntv / Math.max(.2, sys.intensity);
      if (sys.intensity > .04 && t - lastWave > wGap) { spawnWave(); lastWave = t; }
      waves = waves.filter(w => t - w.born < w.life);

      if (sys.speaking > .12 && t - lastVoicePulse > .48) { spawnVoicePulse(); lastVoicePulse = t; }
      voicePulses = voicePulses.filter(p => t - p.born < p.life);

      const pa = geo.attributes.position.array;
      const sa = geo.attributes.aSize.array;
      const ia = geo.attributes.aIntensity.array;

      // SPEAKING STACCATO CALCULATION
      const wordCadence = Math.pow(Math.abs(Math.sin(t * 8.0) * Math.cos(t * 2.5)), 0.5);
      const wordJitter = sys.speaking * wordCadence;

      for (let i = 0; i < DOT_N; i++) {
          const bp = base[i], ph = phases[i];
          const nx = bp.x / SPH_R, ny = bp.y / SPH_R, nz = bp.z / SPH_R;

          let disp = .038 * Math.sin(t * .62 + ph);
          let inten = .22 + .08 * Math.sin(t * .38 + ph);

          // Standard Thinking Waves
          for (const w of waves) {
              const age = t - w.born, front = age * w.spd;
              const dot3 = nx * w.ori.x + ny * w.ori.y + nz * w.ori.z;
              const ang = Math.acos(Math.max(-1, Math.min(1, dot3)));
              const diff = front - ang;
              if (diff > -.28 && diff < .62) {
                  const str = Math.exp(-diff * diff * 17) * w.amp, fade = 1 - age / w.life;
                  disp += str * fade * sys.intensity;
                  inten += str * fade * sys.intensity * 3.4;
              }
          }

          // LISTENING: Concentric Aperture Effect
          if (sys.listening > 0) {
              const distFromCenter = Math.sqrt(nx * nx + nz * nz);
              const ringPulse = Math.sin(distFromCenter * 8.0 - t * 4.5) * 0.5 + 0.5;
              const intakeFactor = Math.pow(ringPulse, 3.0) * sys.listening;

              disp -= intakeFactor * 0.15;
              inten += intakeFactor * 1.2;
              disp -= 0.08 * sys.listening * (0.8 + 0.2 * Math.sin(t * 2.0));
          }

          inten += .05 * sys.intensity * Math.sin(t * 4.4 + ph * 2.1);

          if (sys.speaking > 0) {
              const lon = Math.atan2(nz, nx);
              const eqMask = Math.exp(-ny * ny * 5.5);

              const wordBurst = Math.sin(t * 24.0 + lon * 2.0) * 0.4;
              const f1 = (Math.sin(t * 7.1 + lon * 1.8) + wordBurst) * eqMask;
              const f2 = Math.sin(t * 13.8 + lon * 4.2 + ph) * (1 - eqMask) * 0.45;

              const breath = 0.62 + 0.38 * Math.sin(t * 5.1 + lon * 0.4);

              disp += (f1 * 0.25 + f2 * 0.08) * breath * wordJitter;
              inten += (Math.abs(f1) * 1.5 + Math.abs(f2) * 0.5) * breath * wordJitter * 1.2;

              disp += wordJitter * 0.12 * eqMask;

              for (const p of voicePulses) {
                  const age = t - p.born, front = age * p.spd;
                  const dot3 = nx * p.ori.x + ny * p.ori.y + nz * p.ori.z;
                  const ang = Math.acos(Math.max(-1, Math.min(1, dot3)));
                  const diff = front - ang;
                  if (diff > -.18 && diff < .50) {
                      const str = Math.exp(-diff * diff * 22) * p.amp, fade = 1 - age / p.life;
                      disp += str * fade * sys.speaking;
                      inten += str * fade * p.life * sys.speaking * 2.8;
                  }
              }
          }

          pa[i * 3] = bp.x + nx * disp;
          pa[i * 3 + 1] = bp.y + ny * disp;
          pa[i * 3 + 2] = bp.z + nz * disp;
          sa[i] = B_SIZE * (1 + Math.max(0, inten - .22) * .88);
          ia[i] = Math.min(1, Math.max(0, inten));
      }

      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aIntensity.needsUpdate = true;

      const thinkBoost = 1 + sys.intensity * 4.8;
      const speakBoost = 1 + sys.speaking * (1.4 + wordCadence * 0.8);
      const listenBoost = 1 + sys.listening * 0.4;
      const activeBoost = Math.max(thinkBoost, speakBoost, listenBoost);

      dots.rotation.y += sys.rotY * activeBoost;
      dots.rotation.x += sys.rotX * thinkBoost;
      dots.rotation.z = Math.sin(t * .11) * .04 + sys.intensity * Math.sin(t * 1.75) * .015;

      mat.uniforms.uBlend.value = Math.max(sys.intensity * .54, sys.speaking * .28, sys.listening * 0.5);

      if (t - statsT > .1) {
          statsT = t;
          const rw = document.getElementById('r-w');
          const rs = document.getElementById('r-s');
          const ri = document.getElementById('r-i');
          const rv = document.getElementById('r-v');
          if (rw) rw.textContent = (waves.length + voicePulses.length);
          if (rs) rs.textContent = (sys.rotY * activeBoost).toFixed(4);
          if (ri) ri.textContent = sys.intensity.toFixed(2);
          if (rv) rv.textContent = sys.speaking.toFixed(2);
      }

      renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  // ── SMOOTH STATE TRANSITIONS ──────────────────
  window.setState = function(mode) {
      if (currentMode === mode) return;
      currentMode = mode;

      const pulse = document.getElementById('s-pulse');
      const label = document.getElementById('s-label');
      const ring = document.getElementById('think-ring');
      const intake = document.getElementById('intake-ring');
      const orb1 = document.getElementById('orb1');
      const orb2 = document.getElementById('orb2');
      const vbars = document.getElementById('voice-bars');
      const eqGlow = document.getElementById('eq-glow');

      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      gsap.killTweensOf(sys);

      const duration = 1.8;
      const ease = "power2.inOut";

      if (mode === 'thinking') {
          const btnThinking = document.getElementById('btn-thinking');
          if (btnThinking) btnThinking.classList.add('active');
          gsap.to(sys, { intensity: 1, listening: 0, speaking: 0, duration, ease });
          if (pulse) pulse.className = 's-pulse thinking';
          if (label) label.textContent = 'PROCESSING';
          if (ring) ring.classList.add('active');
          if (intake) intake.classList.remove('active');
          if (vbars) vbars.style.opacity = '0';
          if (eqGlow) eqGlow.style.opacity = '0';
          if (orb1) orb1.style.background = 'radial-gradient(circle,rgba(245,199,54,.12) 0%,transparent 70%)';
          if (orb2) orb2.style.background = 'radial-gradient(circle,rgba(245,199,54,.06) 0%,transparent 70%)';

      } else if (mode === 'listening') {
          const btnListening = document.getElementById('btn-listening');
          if (btnListening) btnListening.classList.add('active');
          gsap.to(sys, { listening: 1, intensity: 0, speaking: 0, duration, ease });
          if (pulse) pulse.className = 's-pulse listening';
          if (label) label.textContent = 'CONSUMING DATA';
          if (ring) ring.classList.remove('active');
          if (intake) intake.classList.add('active');
          if (vbars) vbars.style.opacity = '0';
          if (eqGlow) eqGlow.style.opacity = '0';
          if (orb1) orb1.style.background = 'radial-gradient(circle,rgba(245,199,54,0.08) 0%,transparent 70%)';
          if (orb2) orb2.style.background = 'radial-gradient(circle,rgba(245,199,54,0.06) 0%,transparent 70%)';

      } else if (mode === 'speaking') {
          const btnSpeaking = document.getElementById('btn-speaking');
          if (btnSpeaking) btnSpeaking.classList.add('active');
          gsap.to(sys, { speaking: 1, intensity: 0, listening: 0, duration, ease });
          if (pulse) pulse.className = 's-pulse speaking';
          if (label) label.textContent = 'TRANSMITTING';
          if (ring) ring.classList.remove('active');
          if (intake) intake.classList.remove('active');
          if (vbars) vbars.style.opacity = '1';
          if (eqGlow) {
              eqGlow.style.animation = 'eq-beat 1.05s cubic-bezier(.2,.8,.4,1) infinite';
              eqGlow.style.opacity = '1';
          }
          if (orb1) orb1.style.background = 'radial-gradient(circle,rgba(245,199,54,.08) 0%,transparent 70%)';
          if (orb2) orb2.style.background = 'radial-gradient(circle,rgba(245,199,54,.06) 0%,transparent 70%)';

      } else {
          const btnIdle = document.getElementById('btn-idle');
          if (btnIdle) btnIdle.classList.add('active');
          gsap.to(sys, { intensity: 0, speaking: 0, listening: 0, duration, ease });
          if (pulse) pulse.className = 's-pulse idle';
          if (label) label.textContent = 'IDLE';
          if (ring) ring.classList.remove('active');
          if (intake) intake.classList.remove('active');
          if (vbars) vbars.style.opacity = '0';
          if (eqGlow) eqGlow.style.opacity = '0';
          if (orb1) orb1.style.background = 'radial-gradient(circle,rgba(245,199,54,.06) 0%,transparent 70%)';
          if (orb2) orb2.style.background = 'radial-gradient(circle,rgba(245,199,54,.04) 0%,transparent 70%)';
      }
  };

  window.setSphereColor = function(hex, swatchEl) {
      const nc = new THREE.Color(hex);
      gsap.to(mat.uniforms.uC1.value, { r: nc.r, g: nc.g, b: nc.b, duration: .85, ease: 'power2.out' });
      const hsl = {}; nc.getHSL(hsl);
      const tc = new THREE.Color().setHSL((hsl.h + .44) % 1, Math.min(1, hsl.s * 1.1), Math.min(.72, hsl.l * 1.2));
      gsap.to(mat.uniforms.uC2.value, { r: tc.r, g: tc.g, b: tc.b, duration: .85, ease: 'power2.out' });
      document.documentElement.style.setProperty('--accent', hex);
      const sCore = document.getElementById('s-core');
      const sPulse = document.getElementById('s-pulse');
      if (sCore) sCore.style.background = hex;
      if (sPulse) sPulse.style.background = hex;
      document.querySelectorAll('.readout b').forEach(el => el.style.color = hex);
      document.querySelectorAll('.vbar').forEach(el => el.style.background = hex);
      const eqGlow = document.getElementById('eq-glow');
      if (eqGlow) eqGlow.style.background = hex;
      document.querySelectorAll('.sw').forEach(s => s.classList.remove('active'));
      if (swatchEl) swatchEl.classList.add('active');
      const cpicker = document.getElementById('cpicker');
      if (cpicker) cpicker.value = hex;
  };

  window.addEventListener('resize', () => {
      renderer.setSize(gW(), gH());
      camera.aspect = gW() / gH();
      camera.updateProjectionMatrix();
  });
};

// Initialize sphere when page loads
initSphere().catch(console.error);

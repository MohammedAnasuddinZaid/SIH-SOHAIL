// ZelusXBackground: a cinematic pure-black stage. The ZelusX glyph floats at the
// center with slow parallax drift and a breathing neon glow while a three.js
// particle field orbits behind it. Purely decorative; pauses for users who
// prefer reduced motion (renders a single still frame instead of animating).

import { useEffect, useRef } from "react";
import * as THREE from "three";

const PARTICLE_COUNT = 340;

export function ArenaBackground() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.z = 26;

    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const orange = new THREE.Color("#ff7a1a");
    const blue = new THREE.Color("#6ea4ff");
    const white = new THREE.Color("#ffffff");
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 46;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 30;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16;
      const r = Math.random();
      const c = r > 0.78 ? white : r > 0.5 ? blue : orange;
      const brightness = 0.35 + Math.random() * 0.6;
      colors[i * 3] = c.r * brightness;
      colors[i * 3 + 1] = c.g * brightness;
      colors[i * 3 + 2] = c.b * brightness;
      sizes[i] = 0.1 + Math.random() * 0.22;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    const material = new THREE.PointsMaterial({
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let raf = 0;
    const onResize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const img = new Image();
    img.src = "/zelusx-bg.png";

    const tick = (t: number) => {
      points.rotation.y = t * 0.00002;
      points.rotation.x = Math.sin(t * 0.000013) * 0.05;
      const imgEl = host.querySelector(".zgx-glyph img") as HTMLImageElement | null;
      if (imgEl) {
        const driftX = Math.sin(t * 0.00011) * 14;
        const driftY = Math.cos(t * 0.000085) * 10;
        imgEl.style.transform = `translate3d(${driftX}px, ${driftY}px, 0) rotate(${Math.sin(t * 0.00005) * 2.4}deg)`;
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    if (reduced) {
      renderer.render(scene, camera);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={hostRef} className="arena-bg" aria-hidden="true">
      <div className="zgx-glyph">
        <img src="/zelusx-bg.png" alt="" />
      </div>
    </div>
  );
}
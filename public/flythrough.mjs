import {
  BoxGeometry, CatmullRomCurve3, Color, DoubleSide, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PlaneGeometry, Scene, SphereGeometry, SRGBColorSpace, TubeGeometry,
  Texture, Vector3, WebGLRenderer,
} from "./vendor/three.module.min.js";

const TOUR_SECONDS = 15;
const HEIGHT_SCALE = 1.6;

export async function openFlythrough(canvas, map, photo, steps, color, controls) {
  const { rows, cols, step } = map.reach;
  const response = await fetch("./data/surface.bin");
  if (!response.ok) throw new Error("Terrain surface could not be loaded.");
  const heights = new Float32Array(await response.arrayBuffer());
  if (heights.length !== cols * rows) throw new Error("Invalid terrain surface");

  const legs = steps.filter(item => item.leg);
  const base = legs[0].leg.elevation[0];
  const scene = new Scene();
  scene.background = new Color("#14232b");
  const camera = new PerspectiveCamera(47, 1, 3, 7000);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const world = (x, y, elev) => new Vector3(
    (x - map.width / 2) * map.eastScale,
    (elev - base) * HEIGHT_SCALE,
    y - map.height / 2,
  );
  const meshGeometry = new PlaneGeometry(1, 1, cols - 1, rows - 1);
  const vertices = meshGeometry.attributes.position;
  const uv = meshGeometry.attributes.uv;
  for (let i = 0; i < heights.length; i++) {
    const x = (i % cols) * step;
    const y = Math.floor(i / cols) * step;
    const xyz = world(x, y, heights[i]);
    vertices.setXYZ(i, xyz.x, xyz.y, xyz.z);
    uv.setXY(i, x / map.width, 1 - y / map.height);
  }
  const texture = new Texture(photo);
  texture.needsUpdate = true;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  scene.add(new Mesh(meshGeometry, new MeshBasicMaterial({ map: texture, side: DoubleSide })));

  const curves = legs.map(({ leg, label }) => {
    const points = leg.points.map(([x, y], i) => world(x, y, leg.elevation[i] + 5));
    const simplified = points.filter((_, i) => i % 5 === 0 || i === points.length - 1);
    const curve = new CatmullRomCurve3(simplified);
    const tube = new TubeGeometry(curve, Math.max(100, simplified.length * 2), 2.8, 6, false);
    const isReturn = label === "Walk home";
    scene.add(new Mesh(tube, new MeshBasicMaterial({ color: isReturn ? "#ffad8e" : color })));
    if (!isReturn) {
      const marker = new Mesh(new SphereGeometry(7, 12, 8), new MeshBasicMaterial({ color: "#ffd588" }));
      marker.position.copy(points.at(-1));
      scene.add(marker);
    }
    return { curve, length: leg.distance };
  });
  const home = new Mesh(new BoxGeometry(18, 12, 18), new MeshBasicMaterial({ color: "#a5efd6" }));
  home.position.copy(curves[0].curve.getPoint(0));
  scene.add(home);
  const walker = new Mesh(new SphereGeometry(7, 16, 10), new MeshBasicMaterial({ color: "#ffffff" }));
  scene.add(walker);

  const total = curves.reduce((sum, item) => sum + item.length, 0);
  function pointAt(progress) {
    let distance = Math.min(1, Math.max(0, progress)) * total;
    for (const { curve, length } of curves) {
      if (distance <= length) return curve.getPointAt(Math.min(1, distance / length));
      distance -= length;
    }
    return curves.at(-1).curve.getPoint(1);
  }

  let progress = 0;
  let previous = 0;
  let playing = false;
  let frame;
  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const actual = pointAt(progress);
    const focus = pointAt(progress + 0.065);
    walker.position.copy(actual).add(new Vector3(0, 9, 0));
    const heading = -0.23 + 0.82 * progress;
    const lookAltitude = focus.y * 0.4 + actual.y * 0.6;
    camera.position.set(focus.x + 430 * Math.sin(heading),
                        lookAltitude + 260 + 80 * Math.cos(progress * Math.PI),
                        focus.z + 430 * Math.cos(heading));
    camera.lookAt(focus.x, lookAltitude, focus.z);
    renderer.render(scene, camera);
    controls.progress.value = progress * 100;
  }

  function pause() {
    playing = false;
    previous = 0;
    cancelAnimationFrame(frame);
    controls.play.textContent = progress >= 1 ? "Replay fly-through" : "Play fly-through";
  }

  function tick(now) {
    if (previous) progress = Math.min(1, progress + (now - previous) / (TOUR_SECONDS * 1000));
    previous = now;
    draw();
    if (progress >= 1) pause();
    if (playing) frame = requestAnimationFrame(tick);
  }

  function toggle() {
    if (playing) {
      pause();
      return;
    }
    if (progress >= 1) progress = 0;
    playing = true;
    controls.play.textContent = "Pause fly-through";
    frame = requestAnimationFrame(tick);
  }

  function seek() {
    pause();
    progress = Number(controls.progress.value) / 100;
    draw();
  }

  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  controls.play.addEventListener("click", toggle);
  controls.progress.addEventListener("input", seek);
  draw();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) toggle();

  return () => {
    pause();
    observer.disconnect();
    controls.play.removeEventListener("click", toggle);
    controls.progress.removeEventListener("input", seek);
    scene.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    texture.dispose();
    renderer.dispose();
  };
}

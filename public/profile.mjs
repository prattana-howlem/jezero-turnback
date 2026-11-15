export function createProfile(canvas, reading) {
  const context = canvas.getContext("2d");
  let plan;
  let state;

  const observer = new ResizeObserver(render);
  observer.observe(canvas);

  function updatePlan(steps, color) {
    const walking = steps.filter(step => step.leg);
    const base = walking[0].leg.elevation[0];
    const legs = [];
    let distance = 0;
    for (const { leg, label } of walking) {
      const points = leg.meters.map((meters, i) => [meters + distance, leg.elevation[i] - base]);
      distance += leg.distance;
      legs.push({ points, home: label === "Walk home" });
    }
    const heights = legs.flatMap(({ points }) => points.map(([, elevation]) => elevation));
    const bottom = Math.floor(Math.min(...heights) / 10) * 10;
    const top = Math.ceil(Math.max(...heights) / 10) * 10;
    plan = { legs, base, distance, bottom, top: Math.max(top, bottom + 10), color };
    render();
  }

  function updateWalker(walker) {
    state = walker;
    const rise = Math.round(walker.elevation - plan.base);
    reading.textContent = `${Math.round(walker.meters)} m walked · ${rise > 0 ? "+" : ""}${rise} m vs habitat`;
    render();
  }

  function render() {
    if (!plan) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const left = 44;
    const right = width - 19;
    const bottom = height - 22;
    const top = 10;
    const x = m => left + m / plan.distance * (right - left);
    const y = m => bottom - (m - plan.bottom) / (plan.top - plan.bottom) * (bottom - top);

    context.font = "11px system-ui, sans-serif";
    context.textAlign = "right";
    context.textBaseline = "middle";
    const lines = [...new Set([plan.bottom, 0, plan.top])];
    for (const elevation of lines) {
      const h = y(elevation);
      context.beginPath();
      context.moveTo(left, h);
      context.lineTo(right, h);
      context.strokeStyle = "#354951";
      context.lineWidth = 1;
      context.stroke();
      context.fillStyle = "#a6babd";
      context.fillText(`${elevation > 0 ? "+" : ""}${elevation} m`, left - 7, h);
    }

    for (const [index, { points, home }] of plan.legs.entries()) {
      context.beginPath();
      context.moveTo(x(points[0][0]), y(points[0][1]));
      for (const [distance, elevation] of points.slice(1)) context.lineTo(x(distance), y(elevation));
      context.lineWidth = 2;
      context.strokeStyle = home ? "#ffc2a3" : plan.color;
      context.stroke();
      const [distance, elevation] = points.at(-1);
      context.fillStyle = home ? "#ffc2a3" : "#f3d289";
      context.beginPath();
      context.arc(x(distance), y(elevation), 3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#c8d6d6";
      context.textAlign = home ? "right" : "center";
      context.fillText(home ? "Habitat" : `Stop ${index + 1}`, x(distance), height - 8);
    }
    context.fillStyle = "#a6babd";
    context.textAlign = "left";
    context.fillText("0 m", left, height - 8);

    if (state) {
      const walkerX = x(Math.min(state.meters, plan.distance));
      const walkerY = y(state.elevation - plan.base);
      context.beginPath();
      context.moveTo(walkerX, top);
      context.lineTo(walkerX, bottom);
      context.strokeStyle = "#e9fbf294";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.arc(walkerX, walkerY, 4.5, 0, Math.PI * 2);
      context.fillStyle = "#fff";
      context.fill();
    }
  }

  return { updatePlan, updateWalker };
}

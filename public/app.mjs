import { BUDGET, RESERVE, DELAY, STOP_1_TIME, plan, walkState } from "./model.mjs";
import { createReachLayer } from "./reach.mjs";
import { createProfile } from "./profile.mjs";

const byId = id => document.getElementById(id);
const map = await fetch("./data/map.json").then(response => {
  if (!response.ok) throw new Error("The Jezero map data could not be loaded.");
  return response.json();
});
const [photo, terrain, slope, reachData] = await Promise.all([
  ...["hirise.jpg", "terrain.jpg", "slope.png"].map(file => {
  const img = new Image();
  img.src = "./data/" + file;
  return img.decode().then(() => img);
  }),
  fetch("./data/reach.bin").then(response => {
    if (!response.ok) throw new Error("The reachability layer could not be loaded.");
    return response.arrayBuffer();
  }),
]);
const basemap = byId("terrain");
const tracks = byId("tracks");
for (const canvas of [basemap, tracks]) {
  canvas.width = map.width;
  canvas.height = map.height;
}
const background = basemap.getContext("2d");
const context = tracks.getContext("2d");
const reachLayer = createReachLayer(byId("reachCanvas"), map.reach, reachData, map);
const profile = createProfile(byId("profile"), byId("profileReading"));
const palette = ["#e3fff9", "#ffcb72"];
const durations = route => route.legs.reduce((total, leg) => total + leg.minutes, 0);
const stop2Time = BUDGET - RESERVE - STOP_1_TIME - Math.max(...map.routes.map(durations));
const schedules = map.routes.map(route => plan(route, stop2Time));
const preferred = map.routes.reduce((best, route, i) =>
  durations(route) < durations(map.routes[best]) ? i : best, 0);
const min = value => (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "");
const whole = value => Math.round(value);
const roverLink = "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/";
const stops = [
  {
    name: "Hogwallow Flats survey",
    time: STOP_1_TIME,
    task: "Photograph an exposed bed and record its color, grain size, and layer spacing.",
    why: "Perseverance imaged fine-grained rocks at Hogwallow Flats. A measured photo gives the crew a reference for comparing nearby beds.",
    source: "https://science.nasa.gov/resource/perseverances-mastcam-z-views-hogwallow-flats/",
  },
  {
    name: "Delta bed comparison",
    time: stop2Time,
    task: "Photograph a nearby exposure and compare its grains with Perseverance’s abrasion images from Skinner Ridge and Wildcat Ridge.",
    why: "Differences in grain size can help test how sediment transport changed across the delta.",
    source: "https://science.nasa.gov/photojournal/2-abrasion-patches-from-perseverance-at-jezero-delta",
  },
];
let selected = preferred;
let elapsed = 0;
let delayed = false;
let playing = false;
let frame = null;
let previousStamp = null;
let cardTrigger;
let positionPin;
let roverPins;
let stopPin;
let stopStatus;
const stop2Position = map.routes[0].legs[1].points.at(-1);

function path(points, color, width, dash = []) {
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  context.stroke();
  context.setLineDash([]);
}

function drawMap() {
  const shade = byId("hillshade").checked;
  background.drawImage(shade ? terrain : photo, 0, 0, map.width, map.height);
  basemap.setAttribute("aria-label", shade ? "HiRISE elevation hillshade" : "HiRISE orthophoto of Jezero’s western delta");
  const showSlope = byId("slope").checked;
  if (showSlope) background.drawImage(slope, 0, 0);
  byId("slopeLegend").hidden = !showSlope;
  context.clearRect(0, 0, map.width, map.height);
  const showRover = byId("rover").checked;
  byId("map").classList.toggle("show-rover", showRover);
  roverPins.hidden = !showRover;
  if (showRover) for (const points of map.lines) path(points, "#68acff", 4, [8, 8]);
  const order = [1 - selected, selected];
  for (const i of order) {
    for (const leg of map.routes[i].legs) {
      path(leg.points, delayed ? "#1726279c" : "#172627", delayed ? 7 : 12);
      path(leg.points, delayed ? "#adafac" : palette[i], delayed ? 3 : 6, delayed || i !== selected ? [16, 12] : []);
    }
  }
  if (delayed) {
    const points = schedules[selected].returnLeg.points;
    path(points, "#321d18", 18);
    path(points, "#ffad8e", 11);
  }
}

function place(node, point) {
  node.style.left = point[0] / map.width * 100 + "%";
  node.style.top = point[1] / map.height * 100 + "%";
}

function showCard(trigger, title, content) {
  const card = byId("stopCard");
  card.innerHTML = `<button type="button" class="close" aria-label="Close waypoint card">×</button><h2>${title}</h2>${content}`;
  cardTrigger = trigger;
  card.hidden = false;
  const close = card.querySelector("button");
  close.addEventListener("click", closeCard);
  close.focus({ preventScroll: true });
}

function closeCard() {
  byId("stopCard").hidden = true;
  cardTrigger?.focus({ preventScroll: true });
}

function makePin(point, kind, text, label, parent = byId("markers")) {
  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "pin " + kind;
  pin.textContent = text;
  pin.setAttribute("aria-label", label);
  pin.title = label;
  place(pin, point);
  parent.append(pin);
  return pin;
}

function initMap() {
  const [out, between] = map.routes[0].legs;
  const home = makePin(out.points[0], "home", "H", "Hypothetical habitat");
  home.addEventListener("click", () => showCard(home, "Habitat", "<p>Simulated base and return point.</p>"));
  stops.forEach((stop, i) => {
    const pin = makePin([out, between][i].points.at(-1), "science", String(i + 1), stop.name);
    pin.addEventListener("click", () => showCard(pin, stop.name, `<p><strong>${min(stop.time)} min</strong> · ${stop.task}</p><p>${stop.why}</p><a href="${stop.source}" target="_blank" rel="noreferrer">Perseverance observation</a>`));
    if (i === 1) stopPin = pin;
  });
  stopStatus = document.createElement("span");
  stopStatus.className = "stop-status";
  stopStatus.hidden = true;
  place(stopStatus, stop2Position);
  byId("markers").append(stopStatus);
  roverPins = document.createElement("div");
  byId("markers").append(roverPins);
  for (const rover of map.waypoints) {
    const label = `Perseverance, sol ${rover.sol}`;
    const pin = makePin(rover.point, "rover-point", "", label, roverPins);
    pin.addEventListener("click", () => showCard(pin, label, `<p>Rover site and drive ${rover.rmc.replace("_", " / ")}.</p><a href="${roverLink}" target="_blank" rel="noreferrer">NASA traverse map</a>`));
  }
  positionPin = document.createElement("span");
  positionPin.className = "crew";
  positionPin.setAttribute("aria-hidden", "true");
  byId("markers").append(positionPin);
}

function renderRoutes() {
  byId("routes").innerHTML = map.routes.map((route, i) => {
    const total = field => route.legs.reduce((sum, leg) => sum + leg[field], 0);
    const steep = Math.max(...route.legs.map(leg => leg.slope));
    return `<tr><td><span class="route-indicator" style="background:${palette[i]}"></span>${route.name}${i === preferred ? '<span class="recommended">Recommended</span>' : ""}</td><td>${(total("distance") / 1000).toFixed(2)} km</td><td>${whole(total("climb"))} m</td><td>${steep.toFixed(1)}°</td><td>${min(durations(route))} min</td></tr>`;
  }).join("");
  byId("route").innerHTML = map.routes.map((route, i) => `<option value="${i}">${route.name}</option>`).join("");
  byId("route").value = selected;
  const w = map.weather;
  const date = new Intl.DateTimeFormat("en", { dateStyle:"medium", timeZone:"UTC" }).format(new Date(w.date));
  byId("weather").innerHTML = `<b>${w.pressure.toFixed(2)} Pa</b><a href="${w.source}">Surface pressure</a><br>Sol ${w.sol} · ${date} · ${w.localTime} local mean solar time`;
}

function renderPlan() {
  const schedule = schedules[selected];
  const fullMargin = BUDGET - schedule.fullReturn;
  const homeTime = delayed ? schedule.earlyReturn : schedule.fullReturn;
  const returnMargin = BUDGET - homeTime;
  const segments = delayed ? schedule.retreat : schedule.full;
  const displaySegments = [
    ...segments,
    ...(returnMargin > RESERVE + 0.05 ? [{ label:"Buffer", duration:returnMargin - RESERVE, kind:"reserve" }] : []),
    { label:"Reserve", duration:RESERVE, kind:"reserve" },
  ];
  byId("segments").innerHTML = displaySegments.map(step => {
    const kind = step.kind ?? (step.leg ? "walk" : "task");
    return `<span title="${step.label}: ${min(step.duration)} min" class="segment-${kind}" style="width:${step.duration / BUDGET * 100}%"></span>`;
  }).join("");
  byId("steps").innerHTML = segments.map(step => `<li>${step.label} <b>${min(step.duration)}m</b></li>`).join("");
  const overrun = byId("overrun");
  overrun.hidden = !delayed;
  if (delayed) {
    overrun.style.left = (BUDGET - RESERVE) / BUDGET * 100 + "%";
    overrun.style.width = Math.min(RESERVE, DELAY + RESERVE - fullMargin) / BUDGET * 100 + "%";
    overrun.title = `Original plan after delay: ${min(schedule.fullReturn + DELAY)} min`;
  }
  byId("decision").dataset.state = delayed ? "turn" : "go";
  byId("decisionTitle").textContent = delayed ? "↩ Turn back now" : "✓ Time for Stop 2";
  byId("reason").textContent = delayed
    ? `The 20-min delay means Stop 2 would take you past the 90-min deadline. Head home now to keep ${min(returnMargin)} min in reserve.`
    : `Both stops fit. You’ll be back in ${min(schedule.fullReturn)} min with ${min(fullMargin)} min left, including your 15-min reserve.`;
  stopPin.classList.toggle("skipped", delayed);
  stopPin.title = stops[1].name + (delayed ? " (skipped)" : "");
  stopPin.setAttribute("aria-label", stopPin.title);
  profile.updatePlan(segments, palette[selected]);
  drawMap();
  renderClock();
}

function endTime() {
  const schedule = schedules[selected];
  return delayed ? schedule.earlyReturn : schedule.fullReturn;
}

function renderReach(walker) {
  const visible = byId("reach").checked;
  byId("reachCanvas").hidden = !visible;
  byId("reachLegend").hidden = !visible;
  if (visible) reachLayer.draw(walker, BUDGET - RESERVE - elapsed);
  stopStatus.hidden = !delayed;
  if (delayed) {
    stopStatus.textContent = visible && !reachLayer.contains(stop2Position)
      ? "Stop 2 outside reach" : "Stop 2 skipped";
  }
}

function renderClock() {
  const schedule = schedules[selected];
  const atCheckpoint = Math.abs(elapsed - schedule.checkpoint) < 0.051;
  byId("now").style.left = elapsed / BUDGET * 100 + "%";
  byId("clock").value = elapsed;
  byId("elapsed").textContent = min(elapsed) + " min";
  byId("play").textContent = playing ? "❚❚ Pause" : "▶ Play";
  byId("play").disabled = elapsed >= endTime();
  byId("delay").disabled = delayed || !atCheckpoint;
  byId("instruction").textContent = elapsed >= endTime()
    ? `Back at the habitat with ${min(BUDGET - endTime())} min left.`
    : delayed ? "Turn back now. After the delay, Stop 2 would run past the mission deadline."
    : atCheckpoint ? "Stop 1 complete. Inject the delay to see how the plan changes."
    : elapsed < schedule.checkpoint ? "Press Play to walk to Stop 1, then inject the delay."
    : "Continuing to Stop 2 on the original plan.";
  const walker = walkState(schedule, elapsed, delayed);
  place(positionPin, walker.position);
  renderReach(walker);
  profile.updateWalker(walker);
}

function pause() {
  playing = false;
  previousStamp = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
}

function tick(stamp) {
  const checkpoint = schedules[selected].checkpoint;
  const target = !delayed && elapsed < checkpoint ? checkpoint : endTime();
  if (previousStamp !== null) elapsed = Math.min(target, elapsed + (stamp - previousStamp) * 0.0037);
  previousStamp = stamp;
  if (elapsed >= target) pause();
  renderClock();
  if (playing) frame = requestAnimationFrame(tick);
}

function play() {
  playing = true;
  frame = requestAnimationFrame(tick);
  renderClock();
}

function reset() {
  pause();
  elapsed = 0;
  delayed = false;
  byId("stopCard").hidden = true;
  renderPlan();
}

initMap();
renderRoutes();
renderPlan();

const tour = byId("tour");
let tourRun = 0;
let disposeTour;
byId("openTour").addEventListener("click", async () => {
  pause();
  renderClock();
  const schedule = schedules[selected];
  const run = ++tourRun;
  byId("tourRoute").textContent = `${map.routes[selected].name} · ${delayed ? "Early return" : "Full walk"} · elevation exaggerated 1.6×`;
  byId("tourControls").hidden = true;
  byId("tourStatus").textContent = "Loading HiRISE terrain…";
  tour.showModal();
  try {
    const { openFlythrough } = await import("./flythrough.mjs");
    if (run !== tourRun) return;
    const dispose = await openFlythrough(byId("tourCanvas"), map, photo,
      delayed ? schedule.retreat : schedule.full, palette[selected],
      { play: byId("tourPlay"), progress: byId("tourProgress") });
    if (run !== tourRun) {
      dispose();
      return;
    }
    disposeTour = dispose;
    byId("tourStatus").textContent = "";
    byId("tourControls").hidden = false;
  } catch (error) {
    if (run === tourRun) byId("tourStatus").textContent = "3D could not open. Close this view to continue on the map.";
    console.warn("3D fly-through", error);
  }
});
tour.addEventListener("close", () => {
  tourRun++;
  disposeTour?.();
  disposeTour = undefined;
});

byId("slope").addEventListener("change", drawMap);
byId("rover").addEventListener("change", drawMap);
byId("hillshade").addEventListener("change", drawMap);
byId("reach").addEventListener("change", renderClock);
byId("route").addEventListener("change", event => {
  selected = Number(event.target.value);
  reset();
});
byId("play").addEventListener("click", () => {
  if (playing) {
    pause();
    renderClock();
  } else play();
});
byId("delay").addEventListener("click", () => {
  pause();
  delayed = true;
  elapsed = schedules[selected].checkpoint + DELAY;
  renderPlan();
  play();
});
byId("reset").addEventListener("click", reset);
byId("clock").addEventListener("input", event => {
  pause();
  const time = Number(event.target.value);
  const checkpoint = schedules[selected].checkpoint;
  elapsed = Math.abs(time - checkpoint) < 0.1 ? checkpoint : Math.min(time, endTime());
  renderClock();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !byId("stopCard").hidden) closeCard();
});

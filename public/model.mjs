export const BUDGET = 90;
export const RESERVE = 15;
export const DELAY = 20;
export const STOP_1_TIME = 11;

function reversed(leg) {
  return {
    points: [...leg.points].reverse(),
    clock: [...leg.clock].reverse().map(t => leg.minutes - t),
    minutes: leg.minutes,
    distance: leg.distance,
    meters: [...leg.meters].reverse().map(m => leg.distance - m),
    elevation: [...leg.elevation].reverse(),
    reach: [...leg.reach].reverse().map(([t, id]) => [leg.minutes - t, id]),
  };
}

export function plan(route, stop2Time) {
  const [outbound, between, home] = route.legs;
  const checkpoint = outbound.minutes + STOP_1_TIME;
  const returnLeg = reversed(outbound);
  const outboundSteps = [
    { label: "Walk to Stop 1", leg: outbound, duration: outbound.minutes },
    { label: "Science at Stop 1", duration: STOP_1_TIME, stop: 1 },
  ];
  return {
    checkpoint,
    full: [
      ...outboundSteps,
      { label: "Walk to Stop 2", leg: between, duration: between.minutes },
      { label: "Science at Stop 2", duration: stop2Time, stop: 2 },
      { label: "Walk home", leg: home, duration: home.minutes },
    ],
    retreat: [
      ...outboundSteps,
      { label: "Delay", duration: DELAY, kind: "delay" },
      { label: "Walk home", leg: returnLeg, duration: returnLeg.minutes },
    ],
    fullReturn: checkpoint + between.minutes + stop2Time + home.minutes,
    earlyReturn: checkpoint + DELAY + returnLeg.minutes,
    returnLeg,
  };
}

export function sampleLeg(leg, elapsed) {
  const last = leg.clock.length - 1;
  const next = leg.clock.findIndex(t => t > elapsed);
  const end = next < 0 ? last : Math.max(1, next);
  const start = end - 1;
  const portion = Math.max(0, Math.min(1, (elapsed - leg.clock[start]) / (leg.clock[end] - leg.clock[start])));
  const interpolate = (a, b) => a + (b - a) * portion;
  return {
    position: leg.points[start].map((coord, dim) => interpolate(coord, leg.points[end][dim])),
    elevation: interpolate(leg.elevation[start], leg.elevation[end]),
    meters: interpolate(leg.meters[start], leg.meters[end]),
  };
}

export function fieldAt(leg, elapsed) {
  const frames = leg.reach;
  const next = frames.findIndex(([t]) => t > elapsed);
  if (next < 0) {
    const [, id] = frames.at(-1);
    return { a: id, b: id, mix: 0 };
  }
  if (next === 0) {
    const [, id] = frames[0];
    return { a: id, b: id, mix: 0 };
  }
  const [earlier, a] = frames[next - 1];
  const [later, b] = frames[next];
  return { a, b, mix: (elapsed - earlier) / (later - earlier) };
}

export function walkState(schedule, elapsed, delayed) {
  const steps = delayed ? schedule.retreat : schedule.full;
  let remaining = elapsed;
  let walked = 0;
  let leg = steps[0].leg;
  let legTime = 0;
  for (const step of steps) {
    if (step.leg) {
      leg = step.leg;
      legTime = Math.max(0, Math.min(remaining, step.duration));
      if (remaining <= step.duration) {
        const sample = sampleLeg(leg, legTime);
        return { ...sample, meters: walked + sample.meters, leg, legTime };
      }
      walked += leg.distance;
    } else if (remaining <= step.duration) {
      return { ...sampleLeg(leg, legTime), meters: walked, leg, legTime };
    }
    remaining -= step.duration;
  }
  return { ...sampleLeg(leg, legTime), meters: walked, leg, legTime };
}

export function activeWalk(schedule, elapsed, delayed) {
  return walkState(schedule, elapsed, delayed).position;
}

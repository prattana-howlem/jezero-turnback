export const BUDGET = 90;
export const RESERVE = 15;
export const DELAY = 20;
export const STOP_1_TIME = 11;

export function reversed(leg) {
  return {
    points: [...leg.points].reverse(),
    clock: [...leg.clock].reverse().map(t => leg.minutes - t),
    minutes: leg.minutes,
  };
}

export function plan(route, stop2Time) {
  const [outbound, between, home] = route.legs;
  const checkpoint = outbound.minutes + STOP_1_TIME;
  return {
    checkpoint,
    full: [
      { label: "Walk to Stop 1", leg: outbound, duration: outbound.minutes },
      { label: "Science at Stop 1", duration: STOP_1_TIME },
      { label: "Walk to Stop 2", leg: between, duration: between.minutes },
      { label: "Science at Stop 2", duration: stop2Time },
      { label: "Walk home", leg: home, duration: home.minutes },
    ],
    fullReturn: checkpoint + between.minutes + stop2Time + home.minutes,
    returnLeg: reversed(outbound),
  };
}

export function locate(leg, elapsed) {
  const end = leg.clock.findIndex(t => t > elapsed);
  if (end < 1) return leg.points.at(end === -1 ? -1 : 0);
  const start = end - 1;
  const progress = (elapsed - leg.clock[start]) / (leg.clock[end] - leg.clock[start]);
  return leg.points[start].map((coord, dim) => coord + (leg.points[end][dim] - coord) * progress);
}

export function activeWalk(schedule, elapsed, delayed) {
  if (delayed && elapsed >= schedule.checkpoint + DELAY) {
    return locate(schedule.returnLeg, elapsed - schedule.checkpoint - DELAY);
  }
  let remaining = delayed ? Math.min(elapsed, schedule.checkpoint) : elapsed;
  let position = schedule.full[0].leg.points[0];
  for (const step of schedule.full) {
    if (remaining <= step.duration) return step.leg ? locate(step.leg, remaining) : position;
    if (step.leg) position = step.leg.points.at(-1);
    remaining -= step.duration;
  }
  return position;
}

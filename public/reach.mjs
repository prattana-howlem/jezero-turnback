import { fieldAt } from "./model.mjs";

const NO_ROUTE = 65535;

export function createReachLayer(canvas, spec, fieldData, { width, height }) {
  const { rows, cols, step, fields } = spec;
  const size = rows * cols;
  if (fieldData.byteLength !== size * fields * 2) throw new Error("Invalid reachability data");
  const costs = new Uint16Array(fieldData);
  const margins = new Float32Array(size);
  const mask = document.createElement("canvas");
  mask.width = cols;
  mask.height = rows;
  const maskContext = mask.getContext("2d");
  const pixels = maskContext.createImageData(cols, rows);
  const context = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  let lastKey = "";

  function draw(state, travelMinutes) {
    const { a, b, mix } = fieldAt(state.leg, state.legTime);
    // A tenth of a model minute is much shorter than a visible change in the contour.
    const timeKey = Math.round(travelMinutes * 10);
    const mixKey = Math.round(mix * 32);
    const key = [a, b, mixKey, timeKey].join("/");
    if (key === lastKey) return;
    lastKey = key;
    for (let i = 0; i < size; i++) {
      const home = costs[i];
      const first = costs[a * size + i];
      const second = costs[b * size + i];
      const travel = first + (second - first) * mix;
      const available = home === NO_ROUTE || first === NO_ROUTE || second === NO_ROUTE
        ? -8 : travelMinutes - (home + travel) / 100;
      margins[i] = available;
      const inside = available >= 0;
      pixels.data.set(inside ? [34, 218, 191, 73] : [7, 13, 21, 73], i * 4);
    }
    maskContext.putImageData(pixels, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(mask, -step / 2, -step / 2, cols * step, rows * step);
    drawBoundary(context, margins, rows, cols, step);
  }

  function contains([x, y]) {
    const row = Math.max(0, Math.min(rows - 1, Math.round(y / step)));
    const col = Math.max(0, Math.min(cols - 1, Math.round(x / step)));
    return margins[row * cols + col] >= 0;
  }

  return { draw, contains };
}

function drawBoundary(context, margins, rows, cols, step) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  context.beginPath();
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const first = row * cols + col;
      const a = margins[first];
      const b = margins[first + 1];
      const c = margins[first + cols + 1];
      const d = margins[first + cols];
      if ((a >= 0) === (b >= 0) && (a >= 0) === (c >= 0) && (a >= 0) === (d >= 0)) continue;
      const values = [a, b, c, d];
      const crossings = [];
      corners.forEach(([x, y], i) => {
        const j = (i + 1) % corners.length;
        if ((values[i] >= 0) === (values[j] >= 0)) return;
        const ratio = values[i] / (values[i] - values[j]);
        const [nx, ny] = corners[j];
        crossings.push([(col + x + (nx - x) * ratio) * step,
                        (row + y + (ny - y) * ratio) * step]);
      });
      if (crossings.length === 4 && ((a + b + c + d >= 0) !== (a >= 0))) {
        crossings.unshift(crossings.pop());
      }
      for (let i = 0; i < crossings.length; i += 2) {
        context.moveTo(...crossings[i]);
        context.lineTo(...crossings[i + 1]);
      }
    }
  }
  context.lineWidth = 7;
  context.strokeStyle = "#0d3639b5";
  context.stroke();
  context.lineWidth = 3.5;
  context.strokeStyle = "#74ffe5";
  context.stroke();
}

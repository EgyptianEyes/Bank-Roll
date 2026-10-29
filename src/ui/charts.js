export function drawMiniChart(canvas, series, startValue){
  const ctx = canvas.getContext("2d");
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (!series.length) return;

  let min = Math.min(...series, startValue);
  let max = Math.max(...series, startValue);
  const span = Math.max(1e-9, max - min);
  min -= span * 0.1;
  max += span * 0.1;
  const baseline = height * (1 - (startValue - min) / (max - min));
  ctx.strokeStyle = "rgba(48,209,88,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  ctx.lineTo(width, baseline);
  ctx.stroke();

  ctx.fillStyle = "rgba(90,200,250,0.15)";
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let index = 0; index < series.length; index++){
    const x = width * (index / Math.max(1, series.length - 1));
    const y = height * (1 - (series[index] - min) / (max - min));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(90,200,250,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let index = 0; index < series.length; index++){
    const x = width * (index / Math.max(1, series.length - 1));
    const y = height * (1 - (series[index] - min) / (max - min));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawLineChart(canvas, series, startValue){
  const ctx = canvas.getContext("2d");
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const paddingLeft = 50, paddingRight = 20, paddingTop = 20, paddingBottom = 35;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;
  let min = Infinity, max = -Infinity;
  for (const value of series){
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)){ min = startValue; max = startValue; }
  const span = Math.max(1e-9, max - min);
  min -= span * 0.1;
  max += span * 0.1;

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 5; index++){
    const y = paddingTop + innerHeight * index / 5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + innerWidth, y);
    ctx.stroke();
  }

  const baseline = paddingTop + innerHeight * (1 - (startValue - min) / (max - min));
  ctx.strokeStyle = "rgba(48,209,88,0.2)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(paddingLeft, baseline);
  ctx.lineTo(paddingLeft + innerWidth, baseline);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `12px ${getComputedStyle(document.documentElement).getPropertyValue("--sans")}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(max.toFixed(2), paddingLeft - 10, paddingTop);
  ctx.fillText(min.toFixed(2), paddingLeft - 10, paddingTop + innerHeight);
  if (series.length === 0) return;

  ctx.fillStyle = "rgba(90,200,250,0.12)";
  ctx.beginPath();
  ctx.moveTo(paddingLeft, paddingTop + innerHeight);
  for (let index = 0; index < series.length; index++){
    const x = paddingLeft + innerWidth * (index / Math.max(1, series.length - 1));
    const y = paddingTop + innerHeight * (1 - (series[index] - min) / (max - min));
    ctx.lineTo(x, y);
  }
  ctx.lineTo(paddingLeft + innerWidth, paddingTop + innerHeight);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(90,200,250,0.95)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let index = 0; index < series.length; index++){
    const x = paddingLeft + innerWidth * (index / Math.max(1, series.length - 1));
    const y = paddingTop + innerHeight * (1 - (series[index] - min) / (max - min));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let index = 0; index < series.length; index++){
    const x = paddingLeft + innerWidth * (index / Math.max(1, series.length - 1));
    const y = paddingTop + innerHeight * (1 - (series[index] - min) / (max - min));
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawHistogram(canvas, values){
  const ctx = canvas.getContext("2d");
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const paddingLeft = 50, paddingRight = 20, paddingTop = 20, paddingBottom = 35;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;
  if (!values.length) return;

  let min = Infinity, max = -Infinity;
  for (const value of values){
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min === max){ min--; max++; }
  const bins = Math.min(30, Math.max(10, Math.floor(Math.sqrt(values.length))));
  const counts = new Array(bins).fill(0);
  const span = max - min;
  for (const value of values){
    let index = Math.floor((value - min) / span * bins);
    if (index === bins) index = bins - 1;
    counts[index]++;
  }
  const maximumCount = Math.max(...counts, 1);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 5; index++){
    const y = paddingTop + innerHeight * index / 5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + innerWidth, y);
    ctx.stroke();
  }

  const gap = 2;
  const barWidth = innerWidth / bins;
  for (let index = 0; index < bins; index++){
    const barHeight = innerHeight * counts[index] / maximumCount;
    const x = paddingLeft + index * barWidth;
    const y = paddingTop + innerHeight - barHeight;
    const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
    gradient.addColorStop(0, "rgba(255,169,77,0.75)");
    gradient.addColorStop(1, "rgba(90,200,250,0.75)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + gap, y, barWidth - gap * 2, barHeight);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(x + gap, y, barWidth - gap * 2, Math.min(8, barHeight));
  }

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = `12px ${getComputedStyle(document.documentElement).getPropertyValue("--sans")}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(maximumCount.toString(), paddingLeft - 10, paddingTop);
  ctx.fillText("0", paddingLeft - 10, paddingTop + innerHeight);
}
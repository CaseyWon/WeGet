import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "assets");
const starCount = Number.parseInt(process.env.STAR_COUNT ?? "0", 10);

if (!Number.isInteger(starCount) || starCount < 0) {
  throw new Error(`Invalid STAR_COUNT: ${process.env.STAR_COUNT}`);
}

const plot = {
  left: 88,
  right: 862,
  top: 207,
  bottom: 354,
};

function parseSourceChart(source, totalStars) {
  const tickValues = [...source.matchAll(/<text x="52"[^>]*class="tk">(\d+)<\/text>/g)].map(
    (match) => Number.parseInt(match[1], 10),
  );
  const axisMaximum = Math.max(2, totalStars, ...tickValues);
  const line = source.match(/<polyline points="([^"]+)"[^>]*stroke="#0969da"/);

  if (!line) {
    throw new Error("Unable to find the Star History data line in the source SVG.");
  }

  const sourcePlot = {
    left: 60,
    right: 692,
    top: 96,
    bottom: 300,
  };

  const rawPoints = line[1]
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

  if (rawPoints.length === 0) {
    throw new Error("The source Star History chart contains no usable points.");
  }

  const points = rawPoints.map(([x, y]) => {
    const xRatio = (x - sourcePlot.left) / (sourcePlot.right - sourcePlot.left);
    const count = Math.max(
      0,
      Math.round(((sourcePlot.bottom - y) / (sourcePlot.bottom - sourcePlot.top)) * axisMaximum),
    );

    return {
      x: plot.left + Math.max(0, Math.min(1, xRatio)) * (plot.right - plot.left),
      count,
    };
  });

  const compactPoints = points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1].x ||
      point.count !== points[index - 1].count,
  );

  if (compactPoints.length === 1) {
    return {
      axisMaximum,
      points: [
        { x: plot.left, count: 0 },
        { x: plot.right - 12, count: 0 },
        { x: plot.right, count: compactPoints[0].count },
      ],
    };
  }

  return { axisMaximum, points: compactPoints };
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderChart({ background, foreground, muted, panel, grid }, chart) {
  const yForCount = (count) =>
    plot.bottom - (Math.max(0, Math.min(chart.axisMaximum, count)) / chart.axisMaximum) * (plot.bottom - plot.top);
  const plottedPoints = chart.points.map(({ x, count }) => ({ x, y: yForCount(count) }));
  const linePoints = plottedPoints.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPoints = [
    `${plottedPoints[0].x.toFixed(1)},${plot.bottom}`,
    linePoints,
    `${plottedPoints.at(-1).x.toFixed(1)},${plot.bottom}`,
  ].join(" ");
  const finalPoint = plottedPoints.at(-1);
  const middleTick = Math.ceil(chart.axisMaximum / 2);
  const ticks = [...new Set([0, middleTick, chart.axisMaximum])].sort((a, b) => a - b);
  const gridLines = ticks
    .map((tick) => {
      const y = yForCount(tick).toFixed(1);
      const dash = tick === 0 ? "" : ' stroke-dasharray="5 7"';
      return `<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" stroke="${grid}" stroke-width="1"${dash}/>
  <text x="76" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">${formatNumber(tick)}</text>`;
    })
    .join("\n  ");
  const heading = starCount === 0 ? "等待第一颗 Star" : "Star 增长趋势";
  const description = starCount === 0 ? "出现 Star 后，这里会绘制真实增长曲线。" : "CaseyWon/WeGet · GitHub Stars";
  const totalLabel = `${formatNumber(starCount)} STAR${starCount === 1 ? "" : "S"}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480" viewBox="0 0 960 480" role="img" aria-labelledby="title description">
  <title id="title">WeGet GitHub Star 增长趋势，共 ${starCount} 个 Star</title>
  <desc id="description">${description}</desc>
  <rect width="960" height="480" fill="${background}"/>
  <rect x="34" y="34" width="892" height="412" fill="${foreground}" opacity="0.18"/>
  <rect x="24" y="24" width="892" height="412" fill="${panel}" stroke="${foreground}" stroke-width="2"/>

  <text x="60" y="78" fill="${foreground}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="14" font-weight="700" letter-spacing="2">WEGET / STAR HISTORY</text>
  <text x="60" y="130" fill="${foreground}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="34" font-weight="800">${heading}</text>
  <text x="60" y="158" fill="${muted}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="15">${description}</text>
  <rect x="742" y="66" width="138" height="62" fill="#D8FF46" stroke="${foreground}" stroke-width="2"/>
  <text x="811" y="104" text-anchor="middle" fill="#171714" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="18" font-weight="800">${totalLabel}</text>

  <line x1="${plot.left}" y1="${plot.top}" x2="${plot.left}" y2="${plot.bottom}" stroke="${grid}" stroke-width="2"/>
  ${gridLines}
  <polygon points="${areaPoints}" fill="#D8FF46" opacity="0.18"/>
  <polyline points="${linePoints}" fill="none" stroke="#D8FF46" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="${finalPoint.x.toFixed(1)}" cy="${finalPoint.y.toFixed(1)}" r="9" fill="#D8FF46" stroke="${foreground}" stroke-width="3"/>

  <text x="${plot.left}" y="390" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">START</text>
  <text x="${plot.right}" y="390" text-anchor="end" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">TODAY</text>
</svg>
`;
}

await mkdir(outputDirectory, { recursive: true });

let chart = {
  axisMaximum: 2,
  points: [
    { x: plot.left, count: 0 },
    { x: plot.right, count: 0 },
  ],
};

if (starCount > 0) {
  const source = await readFile(resolve(outputDirectory, "star-history-source.svg"), "utf8");
  chart = parseSourceChart(source, starCount);
}

await Promise.all([
  writeFile(
    resolve(outputDirectory, "star-history.svg"),
    renderChart(
      {
        background: "#F3F0E5",
        foreground: "#171714",
        muted: "#68685F",
        panel: "#FFFDF5",
        grid: "#C9C6BA",
      },
      chart,
    ),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "star-history-dark.svg"),
    renderChart(
      {
        background: "#171714",
        foreground: "#F5F2E8",
        muted: "#AAA79D",
        panel: "#22221E",
        grid: "#4A4A42",
      },
      chart,
    ),
    "utf8",
  ),
]);

console.log(`Rendered WeGet Star History chart with ${starCount} Star${starCount === 1 ? "" : "s"}.`);

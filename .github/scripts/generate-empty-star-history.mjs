import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(process.cwd(), "assets");

function renderChart({ background, foreground, muted, panel, grid }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480" viewBox="0 0 960 480" role="img" aria-labelledby="title description">
  <title id="title">WeGet GitHub Star 增长趋势</title>
  <desc id="description">仓库暂时没有 Star，获得第一颗 Star 后将自动显示增长曲线。</desc>
  <rect width="960" height="480" fill="${background}"/>
  <rect x="34" y="34" width="892" height="412" fill="${foreground}" opacity="0.18"/>
  <rect x="24" y="24" width="892" height="412" fill="${panel}" stroke="${foreground}" stroke-width="2"/>

  <text x="60" y="78" fill="${foreground}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="14" font-weight="700" letter-spacing="2">WEGET / STAR HISTORY</text>
  <text x="60" y="130" fill="${foreground}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="34" font-weight="800">等待第一颗 Star</text>
  <text x="60" y="158" fill="${muted}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="15">出现 Star 后，这里会自动切换为真实增长曲线。</text>

  <line x1="88" y1="354" x2="862" y2="354" stroke="${grid}" stroke-width="2"/>
  <line x1="88" y1="208" x2="88" y2="354" stroke="${grid}" stroke-width="2"/>
  <line x1="88" y1="305" x2="862" y2="305" stroke="${grid}" stroke-width="1" stroke-dasharray="5 7"/>
  <line x1="88" y1="256" x2="862" y2="256" stroke="${grid}" stroke-width="1" stroke-dasharray="5 7"/>
  <line x1="88" y1="207" x2="862" y2="207" stroke="${grid}" stroke-width="1" stroke-dasharray="5 7"/>

  <path d="M 88 354 L 862 354" fill="none" stroke="#D8FF46" stroke-width="5"/>
  <circle cx="475" cy="354" r="12" fill="#D8FF46" stroke="${foreground}" stroke-width="3"/>
  <rect x="423" y="278" width="104" height="48" fill="#D8FF46" stroke="${foreground}" stroke-width="2"/>
  <text x="475" y="309" text-anchor="middle" fill="#171714" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="20" font-weight="800">0 STARS</text>

  <text x="88" y="390" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">START</text>
  <text x="862" y="390" text-anchor="end" fill="${muted}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="12">TODAY</text>
</svg>
`;
}

await mkdir(outputDirectory, { recursive: true });

await Promise.all([
  writeFile(
    resolve(outputDirectory, "star-history.svg"),
    renderChart({
      background: "#F3F0E5",
      foreground: "#171714",
      muted: "#68685F",
      panel: "#FFFDF5",
      grid: "#C9C6BA",
    }),
    "utf8",
  ),
  writeFile(
    resolve(outputDirectory, "star-history-dark.svg"),
    renderChart({
      background: "#171714",
      foreground: "#F5F2E8",
      muted: "#AAA79D",
      panel: "#22221E",
      grid: "#4A4A42",
    }),
    "utf8",
  ),
]);

console.log("Generated zero-star placeholder charts.");

import React from "react";

const FILTER_COLORS = [
  { key: "none", label: "None", angle: 0, color: "rgba(255,255,255,0.22)" },
  { key: "yellow", label: "Yellow", angle: 40, color: "#FCF750" },
  { key: "orange", label: "Orange", angle: 80, color: "#DBA12A" },
  { key: "red", label: "Red", angle: 120, color: "#CD076B" },
  { key: "magenta", label: "Magenta", angle: 160, color: "#970AA0" },
  { key: "blue", label: "Blue", angle: 200, color: "#3054E0" },
  { key: "cyan", label: "Cyan", angle: 240, color: "#83E7EB" },
  { key: "green", label: "Green", angle: 280, color: "#9DEE3A" },
  { key: "yellow-green", label: "Yellow-Green", angle: 320, color: "#CBEE3A" }
];
const FILTER_RING_OFFSET_DEGREES = -20;

function normalizeFilterLabel(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "None";
  if (/^(none|no(?:\s+color)?(?:\s+filter)?)$/i.test(normalized)) return "None";
  return normalized.replace(/\s+filter$/i, "");
}

function normalizeFilterKey(value) {
  return normalizeFilterLabel(value).toLowerCase().replace(/\s+/g, "-");
}

function clampLevel(value, isActive) {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!isActive || !Number.isFinite(parsed)) return 0;
  return Math.min(3, Math.max(0, parsed));
}

function polarToCartesian(center, radius, angle) {
  const angleRadians = ((angle - 90) * Math.PI) / 180;
  return {
    x: center + Math.cos(angleRadians) * radius,
    y: center + Math.sin(angleRadians) * radius
  };
}

function describeArc(center, radius, startAngle, endAngle) {
  const start = polarToCartesian(center, radius, startAngle);
  const end = polarToCartesian(center, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function describeWedge(center, radius, startAngle, endAngle) {
  const start = polarToCartesian(center, radius, startAngle);
  const end = polarToCartesian(center, radius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

export default function MonochromeColorFilterDisplay({ color, level }) {
  const normalizedColor = normalizeFilterLabel(color);
  const filterKey = normalizeFilterKey(color);
  const activeFilter = filterKey !== "none";
  const normalizedLevel = clampLevel(level, activeFilter);
  const filterDef = FILTER_COLORS.find((entry) => entry.key === filterKey) ?? FILTER_COLORS[0];

  const size = 128;
  const center = size / 2;
  const outerRadius = 42;
  const innerFillRadius = 46;
  const dotRadius = 4;
  const crossHalfSize = 6;
  const levelRadius = outerRadius * (normalizedLevel / 3);
  const angleRadians = ((filterDef.angle - 90) * Math.PI) / 180;
  const x = center + Math.cos(angleRadians) * levelRadius;
  const y = center + Math.sin(angleRadians) * levelRadius;
  const lineX = center + Math.cos(angleRadians) * outerRadius;
  const lineY = center + Math.sin(angleRadians) * outerRadius;
  const filterSegments = FILTER_COLORS.map((entry, index) => {
    const nextEntry = FILTER_COLORS[(index + 1) % FILTER_COLORS.length];
    const startAngle = entry.angle + FILTER_RING_OFFSET_DEGREES;
    const nextAngle = nextEntry.angle + FILTER_RING_OFFSET_DEGREES;
    const endAngle = nextAngle > startAngle ? nextAngle : nextAngle + 360;
    return {
      ...entry,
      arcPath: describeArc(center, outerRadius, startAngle, endAngle),
      fillPath: describeWedge(center, innerFillRadius, startAngle, endAngle)
    };
  });

  return (
    <div
      data-mono-filter-display
      data-filter-color={normalizedColor}
      data-filter-level={String(normalizedLevel)}
      style={{
        display: "grid",
        justifyItems: "center",
        gap: 8
      }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#fafafa", textAlign: "center" }}>
        {normalizedColor}
      </span>
      <div
        style={{
          position: "relative",
          width: size,
          height: size
        }}>
        <svg
          data-mono-filter-graphic
          data-filter-ring-offset={String(FILTER_RING_OFFSET_DEGREES)}
          aria-hidden="true"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ position: "absolute", inset: 0 }}>
          {activeFilter ? filterSegments.map((segment) => (
            <path
              key={`fill-${segment.key}`}
              d={segment.fillPath}
              fill={segment.color}
              opacity={segment.key === "none" ? 0.12 : 0.75}
            />
          )) : null}
          {filterSegments.map((segment) => (
            <path
              key={`arc-${segment.key}`}
              d={segment.arcPath}
              fill="none"
              stroke={segment.color}
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          {normalizedLevel > 0 ? (
            <circle
              cx={center}
              cy={center}
              r={levelRadius}
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              opacity="0.95"
            />
          ) : null}
          <line x1={center} y1={center} x2={lineX} y2={lineY} stroke="#444444" strokeWidth="4" opacity="0.95" />
          <g data-filter-level-cross>
            <line
              x1={x - crossHalfSize}
              y1={y}
              x2={x + crossHalfSize}
              y2={y}
              stroke="#ffffff"
              strokeWidth="1.5"
              opacity="0.95"
            />
            <line
              x1={x}
              y1={y - crossHalfSize}
              x2={x}
              y2={y + crossHalfSize}
              stroke="#ffffff"
              strokeWidth="1.5"
              opacity="0.95"
            />
          </g>
          <circle cx={x} cy={y} r={dotRadius} fill="#ffffff" />
        </svg>
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#d4d4d4", textAlign: "center" }}>
        {`Level ${normalizedLevel}`}
      </span>
    </div>
  );
}

import React from "react";

export default function ImageAdjustSliders({ vignette = 0, sharpness = 0, contrast = 0, exposureCompensation = 0 }) {
  return (
    <div style={{ margin: "1rem 0" }}>
      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center" }}>
        <p style={{ width: 150, display: "inline-block" }}>Shading Effect: {vignette}</p>
        <input
          type="range"
          min={-5}
          max={5}
          step={1}
          value={vignette}
          disabled
          style={{ width: 160 }}
        />
      </div>
      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center" }}>
        <p style={{ width: 150, display: "inline-block" }}>Sharpness: {sharpness}</p>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={sharpness}
          disabled
          style={{ width: 160 }}
        />
      </div>
      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center" }}>
        <p style={{ width: 150, display: "inline-block" }}>Contrast: {contrast}</p>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={contrast}
          disabled
          style={{ width: 160 }}
        />
      </div>
      <div style={{ marginBottom: "0.75rem", display: "flex", alignItems: "center" }}>
        <p style={{ width: 150, display: "inline-block" }}>Exposure Comp: {exposureCompensation}</p>
        <input
          type="range"
          min={-2}
          max={2}
          step={0.3}
          value={exposureCompensation}
          disabled
          style={{ width: 160 }}
        />
      </div>
    </div>
  );
}

import React, { memo } from "react";
import SaturationWheel from "./SaturationWheel";
import ShadowMidsHighlightAdjust from "./ShadowMidsHighlightAdjust";
import WhiteBalanceBox from "./white-balance-box";
import ImageAdjustSliders from "./ImageAdjustSliders";

/**
 * Props:
 *  - recipe: the recipe data object as used in RecipeCard
 */
function RecipeSettings({ recipe }) {
  return (
    <div className="recipe-card-settings-flex">
      <div
        className="saturation-wheel-container"
        style={{
          maxWidth: 280,
          minWidth: 280,
          flexShrink: 1,
          border: "1px solid #353535",
          borderRadius: 6,
          background: "#353535",
          padding: 8,
          marginTop: 45
        }}>
        <SaturationWheel
          values={[
            Number(recipe.yellow ?? 0),
            Number(recipe.orange ?? 0),
            Number(recipe.orangeRed ?? 0),
            Number(recipe.red ?? 0),
            Number(recipe.magenta ?? 0),
            Number(recipe.violet ?? 0),
            Number(recipe.blue ?? 0),
            Number(recipe.blueCyan ?? 0),
            Number(recipe.cyan ?? 0),
            Number(recipe.greenCyan ?? 0),
            Number(recipe.green ?? 0),
            Number(recipe.yellowGreen ?? 0)
          ]}
        />
      </div>
      <ShadowMidsHighlightAdjust
        shadows={Number(recipe.shadows ?? 0)}
        mids={Number(recipe.midtones ?? 0)}
        highlights={Number(recipe.highlights ?? 0)}
      />
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch" ,
        margin: 10
        }}>
        {(recipe.whiteBalanceGreenOffset !== undefined || recipe.whiteBalanceAmberOffset !== undefined) && (
          <div style={{ marginBottom: "1em" }}>
            <WhiteBalanceBox
              wb={recipe.whiteBalance2}
              wbTemperature={recipe.whiteBalanceTemperature}
              green={recipe.whiteBalanceGreenOffset ?? 0}
              amber={recipe.whiteBalanceAmberOffset ?? 0}
            />
          </div>
        )}
        <ImageAdjustSliders
          vignette={recipe.shadingEffect}
          sharpness={recipe.sharpness}
          contrast={recipe.contrast}
          exposureCompensation={(recipe.exposureCompensation || 0)/10}
        />
      </div>
    </div>
  );
}

export default memo(RecipeSettings);

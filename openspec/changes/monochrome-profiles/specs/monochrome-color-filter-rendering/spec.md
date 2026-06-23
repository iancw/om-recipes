The color filter and filter level should render as a graphic as two concentric circles. The outer circle is thicker, roughly stroke of 5, and rendered with colors fading between the supported colors: None at 12 o'clock (0 degrees), Yellow (40 deg), Orange (80 degrees), Red (120 deg), Magenta (160 deg), Blue (200 deg), Cyan (240 deg), Green (280 deg), Yellow-Green (320 deg).

The inner circle is thinner (stroke 1 or 2) and always rendered white. It's rendered at a position corresopnding to the filter level. At level 3 it is rendered at the same distance as the outer circle, at level 0 it is rendered at the very center (effectively not rendered)

A radial line is rendered along the angle corresponding to the color filter (0 degrees for none, etc), and a circle is rendered along that line indicating the level amount. With Level 0 the circle is rendered in the center, at level 3 it's rendered along the outer circle. Level 1 and 2 are rendered 1/3 and 2/3s of the outer radius.

The filter color is rendered as a text label above the outer circle.

The level is rendered as a text label below the outer circle.

When filter color is None, the interior of the outer circle is rendered as transparent. When a filter color is selected, the interior of the outer circle is rendered as colors blending corresponding to the assigned outer circle colors.

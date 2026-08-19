# `palette/`

LCH/LAB colour math. The bottom of the layering: no React, no Fluent, no VS Code.

Given a key colour it produces a sixteen-stop ramp by walking a curve through LAB space: two
quadratic bezier curves meeting at the key colour, one running to black and one to white, with an
optional helical hue torsion. `theme/core` turns that ramp into Fluent `BrandVariants`.

`getBrandTokensFromPalette` is the only caller. The math is **internal**: shipping it publicly
would have meant shipping API with no consumer, so it stays behind the boundary until a second
consumer appears. Promoting it later is one line in `exports`; un-shipping it is not.

Nothing here guards its inputs: `hexToHue('')` returns `NaN` and poisons everything downstream.
Normalising the key colour is the caller's job, and `theme/core/themeGenerator.ts` does it.

Adapted from the CSSWG colour conversion reference implementations and Fluent's own palette tooling.

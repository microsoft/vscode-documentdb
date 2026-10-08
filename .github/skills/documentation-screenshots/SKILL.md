---
name: documentation-screenshots
description: Frames and annotates DocumentDB for VS Code screenshots for release notes, documentation and blog posts, so every image shares one visual style (brand background, Fluent 2 shadow, rounded corners, consistent text size). Use when adding or replacing screenshots in docs/release-notes, docs/user-manual or docs/blog-posts, when the operator provides raw captures, or when asked to frame, beautify, annotate (numbered steps, arrows) or unify images.
---

# Documentation and Release Notes Screenshots

Turns raw VS Code captures of the extension into framed images with one shared look. The style was established for the 1.0 release notes and announcement (`docs/release-notes/1.0.md`, `docs/blog-posts/2026-10-release-1.0/`). Follow the recipe below so new images match the existing set.

- Tool: [scripts/frame.py](./scripts/frame.py) (Python 3, `pip install pillow numpy`, Segoe UI fonts)
- Example jobs file: [references/example-jobs.json](./references/example-jobs.json) (the complete 1.0 set)

## When to Use

- Release notes ([writing-release-notes](../writing-release-notes/SKILL.md) Step 1 asks whether screenshots are planned)
- User manual pages and blog posts with product screenshots
- Re-capturing an existing screenshot after a UI change

Generated graphics (hero images, diagrams) are not framed, but they get the same rounded outer corners (see [Generated graphics](#generated-graphics)).

## Workflow

1. **Collect captures.** Capture VS Code in the light theme at about **1920 px wide** (Windows at 125% scaling gives about 1920 x 1160). Cropped captures of a tree, dialog or quick pick are fine. Blue highlight rectangles drawn in the capture are kept as captured.
2. **Name them** `{version}_{feature_name}.png` (snake_case), using the version of the release that shows them, for example `1.0.0_query_playground.png`. Never reuse a name that already exists in the target `images/` folder: older release notes link to those files.
3. **Keep the originals.** Put untouched captures in an `originals/` folder next to the jobs file, outside the committed `images/` folder (keep them locally or in a gitignored scratch folder such as `docs/plan/`). Only framed output is committed. Never edit originals.
4. **Write a jobs file** (see [references/example-jobs.json](./references/example-jobs.json)). `src` and `out` are relative to the jobs file.
5. **Pilot one image**, show it to the operator, and agree on the look before running the rest. Ask for approval image by image for small crops and annotated images.
6. **Run** `python .github/skills/documentation-screenshots/scripts/frame.py path/to/jobs.json` (or add file names to run a subset). Each image takes about 5 seconds.
7. **Reference the images** in Markdown. Every framed image is 1920 px wide, so all use the same display width:

   ```markdown
   <p align="center"><img src="./images/X.Y.Z_feature_name.png" alt="Describe what the image shows" width="800" style="max-width:100%;height:auto;"></p>
   ```

8. **Verify** every image reference resolves, and delete preview and temporary files.

Preview tip: render previews to a new file name each time (`_preview_a.png`, `_preview_b.png`), because image viewers cache by path. To check the transparent corners, preview on a dark background.

## The Recipe

All values are output pixels on the 1920 px canvas. They are defined as constants at the top of `frame.py`.

### Canvas

- Width is always **1920 px**. Smaller captures are not enlarged to fill it; they get more background, so the set looks structured.
- Height is the content height plus **64 px** margin at the top and bottom. With a legend: 64 px above the screenshot, a 48 px gap, the 96 px legend, and 48 px below it.
- Outer corners are **32 px, transparent** (RGBA PNG), about 13 px at the 800 px display width. This is intentionally twice the inner screenshot radius, so both read as equally round.
- No titles or captions inside images. They don't localize; text belongs in the Markdown.

### Background

- Diagonal gradient, position `t = 0.6 * x / width + 0.4 * y / height`, with three stops: `#EEF5FD` at 0, `#EBF3FC` at 0.45, `#E9F8FE` at 1.
- Dot grid: 32 px pitch starting at 16 px, 2 px dot radius, brand blue `#0070E0` at alpha 26 (about 10%).

### Screenshot card

- Full 1920 px captures are scaled to **1792 px wide** (scale 0.9333) and centered.
- Corner radius **16 px**, hairline border `rgba(0, 0, 0, 30)` at 2 px.
- Shadow: Fluent 2 **shadow16 at 2x**, an ambient `0 0 4px` black at 12% plus a key `0 16px 32px` black at 14%.
- **Lanczos** resampling for every resize. Masks, borders, badges and arrows are drawn at 4x and downsampled; shadows are blurred at native size.
- Captures with transparent areas are flattened onto white first, so they never leave holes in the card.

### Floating panels (`"mode": "panels"`)

For captures that show quick picks or dialogs floating on white: each panel is lifted out by its bounding box (`[x0, y0, x1, y1]`, inclusive, source pixels) and placed directly on the background, keeping the panels' relative layout. Panels get an 8 px (source) radius and the same shadow, with no outer card. To find the bounds, scan for the panel border color `#E2E2E5` (panel fill is `#FBFBFD`): the box runs from the outermost border pixel on each side, inclusive, and excludes the panel's own shadow.

### Tight crops

If text touches the edge of a crop, add `"pad": [left, top, right, bottom]` (source pixels), **only on the sides where text touches** and only as much as needed (about 6 to 16 px). Don't pad the other sides for balance. The capture is extended with the color of the pixel near its bottom-right corner; if that pixel is content, set `"pad_color": [r, g, b]` explicitly.

## Text Size (Most Important Rule)

Text in every image should look the same size as text in a full 1920 px capture. Never enlarge a small crop to fill the width: text at double height looks cheap. Small differences are fine.

To choose `scale` for a capture that is not 1920 px wide:

1. Measure a comparable element in a full capture and in the crop: tree row spacing, table row spacing, a repeated label or the editor line height.
2. `scale = 0.9333 * reference / crop`.
3. Reference values for full captures (125% scaling): tree rows about **41 px** apart, Indexes table rows about **55 px**, editor lines about **35.5 px**.
4. `python frame.py --measure capture.png` prints a rough median row spacing. Treat it as a hint and confirm by eye.

Values used for 1.0 (see the example jobs file): tree crop 0.96, Cluster Dashboard 1.12 (captured at a lower zoom), Kubernetes tree 0.81 with pad `[16, 14, 0, 6]` (captured at a higher zoom, text touched the top and left edges), quick picks 0.9333.

## Annotations

Use annotations only when they explain a sequence. By default, add none.

### Numbered step badges

- 56 px rounded square, radius 12, 4 px white border, fill brand blue `#0070E0`.
- Label in Segoe UI Semibold at 31 px, white, centered. Number the badges 1, 2, 3 in the order the user performs the steps.
- Shadow: Fluent shadow8 at 2x.
- Coordinates (`[x, y, "1"]`) are the badge center in source pixels. Place badges **next to** the element they refer to, never covering text or icons:
  - **Tree items and menu entries:** on the **right**, just past the end of the label (or past the inline buttons and the highlight), where there is free space.
  - **Dialogs and quick picks:** on the **left**, just outside the panel edge (about 48 source px), level with the line that asks the question or the item the user selects.
  - Prefer the side with free space; if both sides are free, follow the reading direction (right of tree items, left of panels).

### Legend cards

Only when badges alone are not self-explanatory (as in `1.0.0_copy_and_paste.png`): a row of equal-width white cards under the screenshot, 48 px below it, 96 px high, 24 px apart, with radius 16, a `#E0E0E0` outline and shadow16. Each card has a badge, then text in Segoe UI 24 px, navy `#252F3E`, with UI names in Semibold. Keep the wording short and imperative, using real UI labels, for example "Right-click the source collection and choose **Copy Collection…**". At most two lines per card (the script warns if text overflows). **When the operator supplies legend text, use it verbatim**; only split it into regular and Semibold segments.

### Arrows

To show that one choice leads to the next screen:

- A quadratic Bezier `[[start], [control], [end]]` in source pixels. A corner point such as `[end_x, start_y]` as the control gives a smooth quarter curve.
- Stroke 6 px in brand blue `#0070E0` with a round start cap, a 22 px filled arrowhead at a 28° half-angle, and a thin white halo so it reads over both UI and background.
- Start just right of the chosen item, end just above the next panel. For the landing point, choose `end_x` in the **right third** of the next panel, over empty header space (away from its title text), so the curve is wide and reads as "continue here". For two-step flows, combine badges and an arrow (as in `1.0.0_authentication_methods.png`).

## Colors

| Role                                  | Value                           |
| ------------------------------------- | ------------------------------- |
| Brand blue (badges, arrows, dot grid) | `#0070E0`                       |
| Mid blue (gradients in graphics)      | `#2892DF`                       |
| Azure cyan (gradient end in graphics) | `#3CCBF4`                       |
| Navy (legend text, headings)          | `#252F3E`                       |
| Background gradient stops             | `#EEF5FD`, `#EBF3FC`, `#E9F8FE` |

Fonts: Segoe UI and Segoe UI Semibold, read from the Windows fonts folder. On other systems, set `DOCS_FONT_DIR` to a folder containing `segoeui.ttf` and `seguisb.ttf`.

## Generated Graphics

Hero images, diagrams and other rendered graphics are not framed. After rendering:

- Check the outermost 1 px rows and columns for capture artifacts (a grey line appeared on HTML renders) and crop them.
- Round the outer corners: `python frame.py --round graphic.png`. The radius scales with the image width. Skip images that already have their own shape, such as the install button.

## Validation Checklist

- [ ] Originals kept outside the committed `images/` folder
- [ ] File names follow `{version}_{feature_name}.png` and don't overwrite existing images
- [ ] Every framed image is 1920 px wide, with transparent rounded corners
- [ ] Text size matches full captures (no blown-up crops)
- [ ] Badges and arrows don't cover UI text or icons
- [ ] All images referenced with `width="800"` and descriptive alt text
- [ ] Every image reference resolves; preview files deleted

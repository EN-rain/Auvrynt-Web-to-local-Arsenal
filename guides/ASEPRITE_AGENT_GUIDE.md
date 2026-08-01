# ASEPRITE_AGENT_GUIDE.md

## Scope

Use this guide for Aseprite source assets and pixel-art work, including:

- `.aseprite` and `.ase` documents
- exact pixel edits
- frame-by-frame 2D animation
- layers, palettes, tags, and frame timing
- sprite-sheet and metadata export
- format conversion, nearest-neighbor scaling, crop, and trim

Auvrynt uses Aseprite's native executable, batch CLI, and parameterized Lua API. A GUI plugin is not required for these operations.

## Detection

Configure either the executable directly or the source/build directory:

```text
AUVRYNT_ASEPRITE_PATH=C:\path\to\aseprite.exe
AUVRYNT_ASEPRITE_SOURCE_PATH=C:\path\to\aseprite
```

For a source directory, Auvrynt checks:

```text
build/bin/aseprite.exe
bin/aseprite.exe
aseprite.exe
```

The equivalent config keys are:

```json
{
  "executables": {
    "aseprite": "C:\\path\\to\\aseprite.exe",
    "asepriteSource": "C:\\path\\to\\aseprite"
  },
  "integrations": {
    "aseprite": true
  }
}
```

## Tools

Auvrynt exposes 36 grouped Aseprite tools.

Detection, inspection, capture, and QA:

- `aseprite_detect` — executable, source path, version, and process state.
- `aseprite_live_editor` — install/status the authenticated extension bridge and inspect or control the current unsaved editor state.
- `aseprite_capture_current` — capture the visible Aseprite window with editor UI.
- `aseprite_capture_canvas` — capture only the live unsaved canvas at native or nearest-neighbor scale.
- `aseprite_inspect_file` — document structure, timing, tags, slices, and palette size.
- `aseprite_read_pixels` — exact RGBA or indexed pixel readback, regions, histograms, and alpha bounds.
- `aseprite_audit_sprite` — isolated/semi-transparent pixels, duplicate/empty frames, palette waste, tags, linked cels, and canvas occupancy.
- `aseprite_compare_documents` — structural and per-frame pixel comparison of two `.aseprite` documents.
- `aseprite_animation_audit` — timing outliers, silhouette/anchor movement, duplicates, and loop continuity.

Source safety and maintenance:

- `aseprite_file_safety` — SHA-256 status/assertion, checkpoints, rollback, and checkpoint deletion.
- `aseprite_maintenance` — decode validation, repaired copy, and lossy-format round-trip analysis.
- `aseprite_batch_process` — bounded dry-run or batch audit, convert, export, and repair.
- `aseprite_recovery` — list/archive/discard native recovery sessions or open Aseprite's recovery UI.
- `aseprite_extensions` — inspect resources/extensions/startup errors and explicitly manage user extensions.

Pixel drawing and regions:

- `aseprite_create_sprite` — create a document.
- `aseprite_set_pixels` — surgical exact-coordinate edits.
- `aseprite_draw_shapes` — points, Bresenham lines, and rectangles.
- `aseprite_draw_stroke` — native brushes, pencil/eraser/bucket, inks, pixel-perfect mode, symmetry, and tiled drawing.
- `aseprite_draw_advanced` — ellipse, polygon, gradient, outline, and flood fill.
- `aseprite_edit_region` — copy/composite/scale/rotate/flip regions across files, layers, and frames.
- `aseprite_manage_mask` — persistent rectangular/color/content masks and masked move/clear/fill operations.
- `aseprite_run_safe_command` — curated allowlisted document commands; never arbitrary Lua.

Document structure and animation:

- `aseprite_manage_layers` — basic layer creation, naming, visibility, deletion, and opacity.
- `aseprite_compose_layers` — groups, duplicate/merge/flatten, background conversion, ordering, locking, blending, and soloing.
- `aseprite_manage_frames` — add, duplicate, delete, and retime frames.
- `aseprite_manage_animation` — frame movement/copy/reversal, bulk timing, tag range/direction/repeat updates, and guarded cel-position tweening with linear/ease-in/ease-out/smoothstep easing.
- `aseprite_manage_tags` — basic tag creation, rename, and deletion.
- `aseprite_manage_cels` — inspect/create/delete/move/duplicate/link/unlink cels and edit opacity/z-index.
- `aseprite_manage_document` — resize/crop/trim, grid, pixel ratio, user data, slices, pivots, and nine-slice data.

Color, palettes, tilemaps, import, and export:

- `aseprite_set_palette` — replace the complete document palette.
- `aseprite_manage_color` — inspect/edit palette entries, transparent index, remap colors, ICC profiles, palette files, quantization, dithering, and built-in Game Boy, PICO-8, CGA, C64, DawnBringer16, grayscale, and monochrome presets.
- `aseprite_import_sprite_sheet` — convert a gridded image into frames, timing, and tags.
- `aseprite_manage_tilemap` — native tilesets, tilemap layers, tile pixels, map cells/flip flags, metadata, import, and export.
- `aseprite_export_sprite_sheet` — standard sheet and JSON export.
- `aseprite_manage_export_preset` — reusable full-option export presets, repeat export, and output validation.
- `aseprite_convert_file` — nearest-neighbor conversion, crop, trim, palette, frame/tag/layer filtering, and color mode.

## Required Workflow

1. Call `open_workspace` for the project containing the sprite sources.
2. Call `aseprite_detect` once.
3. Inspect with `aseprite_inspect_file`; use `aseprite_read_pixels` or the audit tools when exact evidence matters.
4. Call `aseprite_file_safety` with `action="status"` and retain the returned SHA-256 version.
5. Pass `expectedVersion` into destructive calls. Leave `checkpoint` enabled unless the user explicitly rejects backups.
6. Make the smallest focused edit.
7. Re-inspect and run the relevant audit or comparison.
8. Export with a project preset and validate the result.
9. Keep project inputs/outputs inside the workspace. Global recovery or extension mutations require explicit `allowGlobalWrite=true`.

## Drawing Rules

- Use integer coordinates only.
- Use `#RRGGBB` or `#RRGGBBAA` colors.
- Prefer `aseprite_set_pixels` for surgical corrections and cluster construction.
- Prefer `aseprite_draw_shapes` for deliberate geometric primitives, not organic automatic tracing.
- Preserve the document palette and pixel scale unless the user asks to change them.
- Do not resample pixel art with smoothing. Aseprite CLI scaling is nearest-neighbor.
- Inspect neighboring frames before changing animation silhouettes.
- Do not overwrite source documents with exported sheets.

## Native Integration and Live Bridge

Native CLI/Lua remains the default for deterministic saved-file operations. The bundled `auvrynt-bridge` extension adds structured access to the already-running editor without opening a network port. It uses an authenticated filesystem request queue under Aseprite's user-data directory.

Use `aseprite_live_editor` for active unsaved document state, document/tab selection, save/undo/redo, playback, onion skin, zoom, active tool/brush/colors, selection, live pixel/stroke edits, and constrained safe commands. Bridge v1.2 adds 46 allowlisted `run_live_command` operations covering exact pixel/image readback; lines, shapes, fill, replace, clear and outline; layer/cel/tag edits; palette ramps and character templates; ellipse/by-color/invert selections; frame duplication/reversal/timing; cel shifting, sprite flip/rotation and cross-document copying; live resize/crop/flatten/grid and tileset templates; symmetry and ordered dithering; palette sorting that preserves indexed pixel appearance; plus live bounds, color statistics, frame comparison and animation validation. Use `aseprite_capture_canvas` for a clean canvas-only capture.

The dashboard uses three distinct states. **Connected** means the live bridge answered an authenticated status request. **Available** means the native executable is usable, or Aseprite is running without a responding bridge. Merely detecting `aseprite.exe` is not a live connection. The bridge is installed by `auvrynt setup aseprite ...` and self-healed at Auvrynt startup; Aseprite must be restarted once after first installation or a bridge upgrade so the extension code is loaded.

MCP clients can cache their tool catalog. After enabling Aseprite or upgrading Auvrynt, reconnect the MCP connector when `aseprite_*` tools do not appear even though the dashboard reports the profile enabled. Auvrynt sends the standard tool-list-changed notification, but not every client refreshes dynamically.

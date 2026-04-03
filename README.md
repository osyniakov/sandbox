# BPMN Editor

An interactive BPMN 2.0 diagram editor built with **React 19 + TypeScript + Vite**, powered by **[yFiles for HTML](https://www.yworks.com/products/yfiles-for-html)**.

## Features

- **Visual editing canvas** — drag, connect, resize, and label BPMN elements
- **BPMN element palette** — all standard BPMN 2.0 shapes organised by category:
  - Events (Start, End, Intermediate, Boundary)
  - Tasks (User, Service, Script, Business Rule, Send, Receive, Sub-Process)
  - Gateways (Exclusive, Parallel, Inclusive, Event-Based)
  - Artifacts (Data Object, Data Store, Group, Text Annotation)
  - Swimlanes (Pool, Lane)
- **Properties panel** — edit label, element type, event definition, and task markers for the selected element
- **Undo / Redo** — full undo history via yFiles undo engine
- **Auto Layout** — one-click BPMN-aware layout algorithm
- **Import / Export** — GraphML import/export, SVG and PNG export

## Prerequisites

yFiles for HTML is a **commercial library** not published on the public npm registry. You need a license before running the project.

### 1. Get a yFiles evaluation license (free, 60 days)

1. Register at **<https://my.yworks.com/>**
2. Download the **yFiles for HTML** evaluation package (zip)
3. Extract the zip — it contains:
   - An npm package tgz (e.g. `yfiles-26.0.0+eval.tgz`)
   - A `demos/` folder with BPMN extension styles

### 2. Install the yFiles package

Place the tgz in the project root under `lib/`:

```
lib/
└── yfiles.tgz    ← rename the tgz from the eval zip to this
```

The `lib/` directory is gitignored.

### 3. Configure the license

```bash
cp license.json.example license.json
```

Open `license.json` and fill in the values from your evaluation download. The file is gitignored and must never be committed.

### 4. Wire up BPMN styles

The BPMN-specific styles (`BpmnNodeStyle`, `BpmnEdgeStyle`, `BpmnLayout`) ship in the evaluation demos folder, not the core package. Copy the style module into the project:

```bash
# Path inside the extracted eval zip (exact name may vary by version)
cp <eval-zip>/demos/complete/bpmn/bpmn-view.js src/lib/bpmn-styles.js
```

Then update the import in `src/yfiles/bpmn-styles.ts`:

```diff
-// styles imported from 'yfiles' (placeholder)
+import { BpmnNodeStyle, BpmnEdgeStyle, BpmnLayout } from '../lib/bpmn-styles'
```

### 5. Install dependencies and start

```bash
npm install
npm run dev
```

The app runs at <http://localhost:5173>.

---

## Project Structure

```
src/
├── main.tsx                    # Entry point — bootstraps yFiles license, mounts React
├── App.tsx                     # Root layout (toolbar + 3-panel body)
│
├── yfiles/
│   ├── license-init.ts         # Applies License.value before any graph is created
│   └── bpmn-styles.ts          # Node/edge style factory per BPMN element type
│
├── hooks/
│   ├── useGraphComponent.ts    # GraphComponent lifecycle (init, cleanup, drop handler)
│   ├── useUndoRedo.ts          # Subscribes to undo engine → canUndo/canRedo state
│   └── useSelection.ts         # Subscribes to graph selection → React state
│
├── services/
│   ├── layout.ts               # BpmnLayout.morphLayout wrapper
│   └── import-export.ts        # GraphML / SVG / PNG import and export
│
├── components/
│   ├── Toolbar/                # Zoom, fit, undo/redo, layout, import/export buttons
│   ├── Palette/                # Left panel — categorised draggable BPMN items
│   ├── Canvas/                 # Center panel — hosts the yFiles GraphComponent div
│   ├── PropertiesPanel/        # Right panel — label/type/marker editor
│   └── ErrorBanner/            # Shown when yFiles is not installed
│
└── types/
    ├── bpmn.ts                 # BpmnNodeType / BpmnEdgeType enums, PaletteEntry[]
    └── graph-state.ts          # SelectionState interface
```

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server at `localhost:5173` |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

## Architecture Notes

- **yFiles owns the graph state** — the `IGraph` object is the single source of truth. React reflects it through event listeners, never duplicates it.
- **`useGraphComponent`** initialises the `GraphComponent` once in a `useEffect` and stores it in a ref, so React re-renders never recreate the graph.
- **License must be applied first** — `main.tsx` calls `initLicense()` before React renders anything that touches yFiles APIs.
- **`optimizeDeps.exclude: ['yfiles']`** — yFiles must be excluded from Vite's esbuild pre-bundler. Its internal module wiring breaks under esbuild transformation.

## License

Application code in this repository is MIT licensed. yFiles for HTML is subject to the [yWorks license terms](https://www.yworks.com/products/yfiles-for-html/license-types).

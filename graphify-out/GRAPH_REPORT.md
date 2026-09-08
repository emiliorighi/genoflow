# Graph Report - genoflow  (2026-09-08)

## Corpus Check
- 11 files · ~3,858 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 102 nodes · 112 edges · 11 communities (8 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- page.tsx
- compilerOptions
- components.json
- dependencies
- package.json
- devDependencies
- aliases
- button.tsx
- layout.tsx
- next.config.mjs
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `tailwind` - 6 edges
3. `aliases` - 6 edges
4. `project()` - 6 edges
5. `scripts` - 4 edges
6. `Detail()` - 3 edges
7. `Button()` - 3 edges
8. `Species` - 3 edges
9. `matchesFilter()` - 3 edges
10. `flowLabel()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `Marker()` --calls--> `project()`  [EXTRACTED]
  assemblage/app/map/page.tsx → assemblage/lib/mock-species.ts
- `Arc()` --calls--> `project()`  [EXTRACTED]
  assemblage/app/map/page.tsx → assemblage/lib/mock-species.ts
- `MiniMap()` --calls--> `project()`  [EXTRACTED]
  assemblage/app/page.tsx → assemblage/lib/mock-species.ts
- `Detail()` --calls--> `flowLabel()`  [EXTRACTED]
  assemblage/app/map/page.tsx → assemblage/lib/mock-species.ts
- `Detail()` --calls--> `formatCoord()`  [EXTRACTED]
  assemblage/app/map/page.tsx → assemblage/lib/mock-species.ts

## Import Cycles
- None detected.

## Communities (11 total, 3 thin omitted)

### Community 0 - "page.tsx"
Cohesion: 0.15
Nodes (16): Arc(), Detail(), Layers, MapPage(), Marker(), MiniMap(), previewArcs, filters (+8 more)

### Community 1 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 2 - "components.json"
Cohesion: 0.17
Nodes (11): iconLibrary, rsc, $schema, style, tailwind, baseColor, config, css (+3 more)

### Community 3 - "dependencies"
Cohesion: 0.17
Nodes (12): dependencies, @base-ui/react, class-variance-authority, clsx, lucide-react, next, react, react-dom (+4 more)

### Community 4 - "package.json"
Cohesion: 0.25
Nodes (7): name, private, scripts, build, dev, start, version

### Community 5 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, postcss, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom, typescript

### Community 6 - "aliases"
Cohesion: 0.33
Nodes (6): aliases, components, hooks, lib, ui, utils

### Community 7 - "button.tsx"
Cohesion: 0.70
Nodes (3): Button(), buttonVariants, cn()

## Knowledge Gaps
- **64 isolated node(s):** `metadata`, `viewport`, `Layers`, `previewArcs`, `$schema` (+59 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `metadata`, `viewport`, `Layers` to the rest of the system?**
  _64 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14624505928853754 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
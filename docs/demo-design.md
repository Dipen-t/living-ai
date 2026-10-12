# Runtime demo design

The interface is an ERP table workbench. Its main job is to let a developer inspect a supported change while seeing that the baseline stays intact.

Palette: paper `#ffffff`, workspace `#edf3f7`, ink `#1d3344`, navy `#163c5b`, action blue `#246caa`, status green `#247765`. Typography uses Segoe UI with native system fallbacks; restrained weights distinguish table data, controls and headings.

Desktop layout is left aligned with a narrow operation editor beside vertically stacked baseline/preview tables. On mobile the editor precedes the tables. The preview border and tint are the main visual distinction. No hero imagery or decorative metrics compete with the actual runtime behavior.

```text
EvolveKit                         Synthetic data
Small changes. Working previews.
+----------------+-----------------------------+
| Draft controls | Baseline customers          |
| Filters        +-----------------------------+
| Columns        | Proposed customers          |
| Saved view     | Shared table interactions   |
| Open preview   | Inspect configuration       |
+----------------+-----------------------------+
```

Review: tables convey the product directly; synthetic data and fixed date are disclosed. Controls use explicit local-draft language. The request box labels its provider as Gemini or Local rules, and generation history distinguishes pending/successful/unsupported results. Keyboard-accessible move controls avoid requiring drag-and-drop. The proposal panel and preview receive different treatments because their functions differ.

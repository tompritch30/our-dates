# Our Next Dates

A small static site: a date planner, a searchable list and a map. Everything is driven by three JSON files, so changes rarely touch code.

| File | What it holds | Typical change |
|---|---|---|
| `places.json` | Every spot (see `schema.json`) | Add, edit or close a spot |
| `config.json` | Types, moods (as rules), filters, planner questions, plan templates, travel speeds, wording | New category, mood, filter or kind of date |
| `plans.json` | Ready-made plans pointing at place ids | Add a curated plan |
| `app.js`, `style.css`, `index.html` | Engine and look | Rarely |

## Common edits

- **New spot:** add an object to `places.json`. Required fields are in `schema.json`.
- **Close a spot:** set `"status": "closed"`. It disappears everywhere, and plans that pointed to it show the name as plain text.
- **New mood:** add to `config.moods` with a rule. Rules combine `tags`, `text`, `types`, `dressMin/Max` and `spendMin/Max`, nested in `any` / `all`.
- **New category:** add to `config.types` (id, label, map colour), then use that id as a place's `type`.
- **New kind of date:** add a template under `config.planner.templates`. Each step lists allowed `types`, optional `slot`, a `time`, which earlier step it should be `near`, and `maxMin` travel time. Mark one step `anchor` (it carries the mood and area) and meal steps `meal` (kept varied by cuisine).
- **Nights in:** places with `"type": "nightin"`, `"region": "H"` and a `kind` (cook, sweet, watch, play, make, treat). Planner templates under `templates.in` pick by kind.
- **Events that end:** give them `dates.to`. They disappear the day after.
- **Links:** requests and saved lists carry a link (`#plan=…` or `#saved=…`) that opens a page with every stop's Maps, booking tip and directions.
- **Travel speeds:** `config.planner.travel.modes`. Times are estimates from straight-line distance; the Directions links give exact times in Google Maps.

## Hosting

GitHub Pages: upload all files to the repository root, then Settings, Pages, deploy from `main` / root.
The site is public to anyone with the link and hidden from search engines. Keep personal details out of the data.

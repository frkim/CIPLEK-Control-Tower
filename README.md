# CIPLEK · Supply Chain Control Tower

A responsive, frontend-only supply chain workspace for CIPLEK. **All shipments, people, values, events, and forecasts are synthetic.** This is a decision-support demonstration, not a live operational or authentication system.

## Run locally

Use Node.js 24 LTS (Node 22.23 is also compatible) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. No backend, API keys, account, external fonts, or runtime data services are required.

```sh
npm run lint     # Scaffold-provided Oxlint checks
npm test         # Deterministic business-logic tests using Node's built-in runner
npm run build    # Strict TypeScript checks and production bundle
npm run preview # Serve the production bundle locally
```

Deploy the generated `dist/` directory to a static web host. Configure HTTPS and appropriate security headers on that host; the application does not implement a server.

## Explore

- **Overview:** animated portfolio KPIs, an interactive offline world map, delivery performance, and shipment tracking.
- **Shipments:** search shipment IDs, ports, countries, and cargo; combine status, mode, and route filters; sort columns, paginate, open details, and export the filtered portfolio as CSV.
- **Analytics:** change chart periods and compare current route-level performance.
- **Scenarios:** simulate a Suez Canal disruption and compare Cape of Good Hope, priority air freight, and Eurasian rail alternatives. Applying an alternative updates ETAs, delays, KPIs, and the map. Reset restores the exact original portfolio.
- **Theme:** the light/dark toggle follows the OS initially, then saves an explicit preference locally. The app remains usable when browser storage is blocked.

## Simulation assumptions

The fixed November 2026 portfolio contains 24 shipments on five routes. A Suez disruption adds eight days to affected active ocean shipments; delivered shipments and unaffected routes are unchanged. Each alternative independently recovers a bounded number of days from the disrupted baseline, so switching alternatives does not compound results. Cost and CO₂ differences are illustrative estimates, not quotes or a carbon accounting model. Shipment value represents cargo value, not freight cost, and does not change with a routing scenario. Historic chart volumes are synthetic illustrative series; the on-time series reflects the current simulated portfolio rate.

## Architecture and standards

Built with React, strict TypeScript, Vite, Tailwind CSS, Lucide icons, and Recharts. The pure data/simulation layer is in `src/domain/`, the offline map is in `src/components/`, and dashboard orchestration lives in `src/App.tsx`. Local state is sufficient for this small, backend-free demonstration; reloading resets simulations and filters.

This project follows the relevant [ai-coding-standards](https://github.com/frkim/ai-coding-standards/): semantic accessible controls, keyboard interaction, reduced-motion support, persistent OS-aware themes, searchable/sortable/filterable tables, strict typing, lockfile installs, dependency review, and tested domain behavior.

**Stack decision:** the issue explicitly requests React, Tailwind, and Recharts with no backend. Vite replaces the standards' Next.js default, custom Tailwind-styled controls replace Material UI, and Recharts replaces D3. The scaffold's Oxlint and Node's dependency-free test runner are retained rather than adding overlapping tooling. Node 22.23 was available in the implementation environment; Node 24 LTS is recommended for development.

The demo profile is fictional and grants no permissions. Search input is rendered as text, CSV cells are escaped, and no credentials or real shipment information are included.

### Visual design

The proposed project palette is centralized in `src/index.css`: corporate blue and navy structure the interface, green marks positive outcomes, and orange highlights attention states. These are working project colors, not an official third-party identity. Theme-aware semantic tokens provide higher-contrast text variants in light and dark modes; the palette's medium grey is not used for small text on white. Dashboard and map styles reuse these tokens, with a 16px base, 14-16px body/control text, and larger headings. Narrow layouts reflow cards and controls rather than shrinking text, and wide data tables scroll within their panel.

### Map attribution

Map geometry is bundled locally from [Natural Earth](https://www.naturalearthdata.com/), public-domain cartographic data. Routes are schematic and must not be used for navigation.

## License

[MIT](LICENSE).

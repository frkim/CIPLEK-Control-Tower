# CIPLEK · Supply Chain Control Tower

A responsive, frontend-only supply chain workspace for CIPLEK. **All shipments, people, values, events, and forecasts are synthetic.** This is a decision-support demonstration, not a live operational or authentication system.

## Run locally

Use Node.js 24 LTS and its bundled npm.
Run `nvm use` to select the same version as CI. The `.npmrc` registry-prefix
setting downloads the existing lockfile's packages from public npm without changing
their versions or integrity hashes.

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

## CI/CD on Azure

The [CI/CD workflow](.github/workflows/ci-cd.yml) runs lint, tests, a production
build, and Bicep lint/build on pull requests, pushes to `main`, and manual runs.
Only successful runs on `main` deploy, using the exact checked build artifact.
Pull requests never receive Azure credentials or deploy. Production deployments
are serialized rather than cancelled midway.

The host is **Azure Static Web Apps, Free tier**, with managed HTTPS, SPA fallback,
and security headers in `public/staticwebapp.config.json`. Bicep manages the site;
no backend, paid App Service plan, or additional stored deployment token is needed.

### One-time setup

1. Create a resource group in the target Azure subscription (for example
   `rg-ciplek-prod-westeurope`). Register the `Microsoft.Web` resource provider if
   it is not already registered.
2. Give the deployment service principal **Contributor on that resource group**,
   not the whole subscription. This permits ARM deployment and retrieving the
   Static Web Apps deployment token; the app itself has no Azure identity or data access.
3. Add the Actions secret **`AZURE_CREDENTIALS`**, containing the Azure login JSON
   fields `clientId`, `clientSecret`, `subscriptionId`, and `tenantId`. Never commit
   this JSON. This is the issue-requested exception to the linked standards'
   OIDC preference; migrate to federated identity when that requirement changes.
4. Configure these Actions variables in the repository or `production` environment:

   | Variable | Value |
   | --- | --- |
   | `AZURE_RESOURCE_GROUP` | The existing resource group name |
   | `AZURE_STATIC_WEB_APP_NAME` | The site name, for example `swa-ciplek-prod` |
   | `AZURE_LOCATION` | Optional supported Static Web Apps region; defaults to `westeurope` |

5. Create the GitHub **`production` environment**, require reviewers, and restrict
   deployment branches to `main`. These protections must be configured in GitHub;
   naming an environment in workflow YAML does not enable them.
6. Merge the workflow into `main`, then use **Actions → CI/CD → Run workflow → main**
   (or `gh workflow run ci-cd.yml --ref main`).

Deployment validates ARM parameters, prints a Bicep `what-if`, provisions the
site, and retrieves a runtime-only masked deployment token via `AZURE_CREDENTIALS`.
The deploy action skips rebuilding. The final step fetches the public HTTPS page,
JavaScript, CSS, theme script, and favicon and compares them with the build artifact;
a failed or stale deployment fails the job. The verified URL appears in the run
summary and environment. Open it and exercise navigation, theme switching, shipment
filtering, and scenario simulation for an interactive acceptance check.

Azure credentials are unavailable during local validation. A passing local build
does not establish that an Azure deployment has succeeded; check the actual Actions
run and its live verification step after configuring the above.

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

### Map attribution

Map geometry is bundled locally from [Natural Earth](https://www.naturalearthdata.com/), public-domain cartographic data. Routes are schematic and must not be used for navigation.

## License

[MIT](LICENSE).

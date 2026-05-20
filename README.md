# BPMN Studio

A starter for building BPMN diagrams with
[`bpmn-js`](https://github.com/bpmn-io/bpmn-js).

- **Frontend:** Angular 18 (standalone components) + bpmn-js modeler & viewer
- **Backend:** Spring Boot 3.3 (Java 21) with Spring Data JPA + H2 (in-memory)
- **Persistence:** diagrams stored as XML in the `diagram` table
- **Packaging:** dev = two servers; prod = single fat jar serving SPA + API

## Layout

```
backend/    Spring Boot REST API (Maven)
frontend/   Angular app (npm)
```

## Prerequisites

- Java 21+
- Maven 3.9+ (the wrapper `./mvnw` is also included)
- Node 22+ and npm 10+ (for the frontend)

## Run in development

Run the backend and the Angular dev server in two terminals. The Angular dev
server proxies `/api/**` to the backend on `:8080`, so the frontend code only
talks to its own origin.

**Terminal 1 — backend**
```bash
cd backend
./mvnw spring-boot:run
```
- API: `http://localhost:8080/api/diagrams`
- H2 console: `http://localhost:8080/h2-console`
  (JDBC URL `jdbc:h2:mem:bpmn`, user `sa`, blank password)

**Terminal 2 — frontend**
```bash
cd frontend
npm install
npm start
```
- App: `http://localhost:4200`

## Build & run the production bundle

The `prod` Maven profile downloads Node, runs `npm install` + `ng build`, and
copies `frontend/dist/bpmn-app/browser/` into the jar so a single
`java -jar` serves both the SPA and the API.

```bash
cd backend
./mvnw -Pprod clean package
java -jar target/bpmn-backend-0.0.1-SNAPSHOT.jar
```

Visit `http://localhost:8080/` — the SPA loads, deep links like
`/diagrams/1/edit` work (the backend forwards unknown GETs to
`index.html`), and `/api/diagrams` continues to serve JSON.

## REST API

| Method | Path                  | Body                | Response                 |
|--------|-----------------------|---------------------|--------------------------|
| GET    | `/api/diagrams`       | —                   | `DiagramSummary[]`       |
| GET    | `/api/diagrams/{id}`  | —                   | `Diagram` (incl. `xml`)  |
| POST   | `/api/diagrams`       | `{name, xml}`       | created `Diagram`, 201   |
| PUT    | `/api/diagrams/{id}`  | `{name, xml}`       | updated `Diagram`        |
| DELETE | `/api/diagrams/{id}`  | —                   | 204                      |

## Frontend features

- **Diagram list** — table with name, last-updated, and per-row open / view / delete
- **Modeler** — drag-from-palette BPMN editing with Save / Save-as, Import .bpmn, Export .bpmn, Export .svg
- **Viewer** — read-only `NavigatedViewer` with pan & zoom
- **New diagram** — bootstraps from `src/assets/bpmn/newDiagram.bpmn`

## Tests

**Backend integration test** (Spring + H2, CRUD happy path):
```bash
cd backend
./mvnw test
```

**End-to-end tests** (Playwright drives a real browser against the
running backend + Angular dev server — `playwright.config.ts` spawns
both for you):
```bash
cd frontend
npm run e2e          # headless run
npm run e2e:ui       # interactive UI mode
npm run e2e:report   # open the last HTML report
```

The suite (`frontend/e2e/diagrams.spec.ts`) covers:
- empty state on the diagram list
- creating a new diagram via the modeler and seeing it in the list
- opening an existing diagram for editing, renaming, and persisting
- exporting a diagram as `.bpmn` (validates the browser download)
- the read-only viewer rendering the BPMN process SVG
- deleting a diagram from the list

Each test starts from a clean database (the API is used to clear rows in
`beforeEach`). Playwright in CI is pinned to a chromium revision that
matches the pre-installed browsers in this environment; locally
`npm run e2e` will auto-download what's missing.

## Notes

- The H2 database is in-memory; restarting the backend resets all diagrams.
  Switch the JDBC URL in `application.yml` to `jdbc:h2:file:./data/bpmn` to
  keep state across restarts, or swap the H2 dependency for PostgreSQL.
- CORS allows `http://localhost:4200` by default; override with
  `app.cors.allowed-origins` (comma-separated).
- bpmn-js stylesheets (`diagram-js.css`, `bpmn-embedded.css`) are wired in
  via `angular.json`.

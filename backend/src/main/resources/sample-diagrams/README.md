# Sample BPMN diagrams

These diagrams are bundled into the backend jar and loaded on first
startup by `SampleDiagramSeeder` (the table-empty guard means once the
DB has any diagram, the seeder skips). Files are processed in
filename order, so the leading numeric prefix controls their position
in the UI list. The filename (sans the prefix and extension) is
turned into the diagram name shown to users.

## Provenance

All eight `.bpmn` files are taken verbatim from MIT-licensed bpmn-io
repositories:

| Local file                                      | Upstream source |
|-------------------------------------------------|-----------------|
| `01-simple-sub-process.bpmn`                    | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/simple.bpmn` |
| `02-conditional-flows.bpmn`                     | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/conditions.bpmn` |
| `03-boundary-events.bpmn`                       | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/boundary-events.bpmn` |
| `04-event-sub-process.bpmn`                     | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/event-sub-processes.bpmn` |
| `05-nested-sub-processes.bpmn`                  | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/nested-subprocesses.bpmn` |
| `06-collaboration-message-flows.bpmn`           | `bpmn-io/bpmn-js` — `test/fixtures/bpmn/collaboration-message-flows.bpmn` |
| `07-qr-scan-process.bpmn`                       | `bpmn-io/bpmn-js-examples` — `starter/diagram.bpmn` |
| `08-pizza-collaboration.bpmn`                   | `bpmn-io/bpmn-js-examples` — `commenting/resources/pizza-collaboration.bpmn` |

To refresh, re-fetch from `raw.githubusercontent.com/bpmn-io/...` and
commit the updated files. To suppress the auto-seed entirely, start
the backend with `app.seed.enabled=false`.

# todo-api

A small in-memory TODO REST API written in plain Java 21, using
`com.sun.net.httpserver.HttpServer` (no frameworks). JSON is handled with
Jackson.

## Build

```
mvn -q package
```

This compiles the code, runs the tests, and produces a runnable fat jar at
`target/todo-api.jar` (via `maven-shade-plugin`, so Jackson is bundled).

Run just the tests with:

```
mvn -q test
```

## Run

```
java -jar target/todo-api.jar
```

The server listens on port `8080` by default. Set the `PORT` environment
variable to use a different port:

```
PORT=9090 java -jar target/todo-api.jar
```

On startup it prints the port it's listening on, e.g.:

```
todo-api listening on port 8080
```

## API

All request/response bodies are JSON. A todo looks like:

```json
{ "id": "generated-uuid", "title": "Buy milk", "completed": false }
```

| Method | Path          | Description                                  |
|--------|---------------|-----------------------------------------------|
| POST   | `/todos`      | Create a todo from `{"title": ..., "completed"?: ...}`. Returns 201 + the created todo. 400 if `title` is missing/blank or the body is malformed JSON. |
| GET    | `/todos`      | List all todos. Returns 200 + a JSON array.   |
| GET    | `/todos/{id}` | Fetch one todo. Returns 200 + the todo, or 404 if unknown. |
| PUT    | `/todos/{id}` | Full update of `title`/`completed`. Returns 200 + the updated todo. 404 if unknown, 400 if the body is invalid. |
| DELETE | `/todos/{id}` | Delete a todo. Returns 204, or 404 if unknown. |

Unsupported methods on known paths return 405. Every JSON response sets
`Content-Type: application/json`.

## Example

```
curl -s -X POST localhost:8080/todos -d '{"title":"Buy milk"}'
curl -s localhost:8080/todos
curl -s -X PUT localhost:8080/todos/<id> -d '{"title":"Buy milk","completed":true}'
curl -s -X DELETE localhost:8080/todos/<id> -o /dev/null -w '%{http_code}\n'
```

# TODO REST API

A small in-memory TODO REST API built with plain Java 21 (`com.sun.net.httpserver.HttpServer`, no frameworks).

## Build

```sh
cd app
mvn -q package
```

This produces a runnable, dependency-bundled jar at `target/todo-1.0-SNAPSHOT.jar`.

## Run

```sh
java -jar target/todo-1.0-SNAPSHOT.jar
```

The server listens on port `8080` by default. Override with the `PORT` environment variable:

```sh
PORT=18123 java -jar target/todo-1.0-SNAPSHOT.jar
```

On startup the process prints the port it is listening on.

## Test

```sh
cd app
mvn -q test
```

## API reference

A todo has `id` (server-generated string), `title` (required, non-blank string), and `completed` (boolean, defaults to `false`).

| Method | Path          | Description                                   | Success | Errors |
|--------|---------------|------------------------------------------------|---------|--------|
| POST   | `/todos`      | Create a todo from JSON `{"title": ..., "completed"?: ...}` | 201 with created todo (including `id`) | 400 malformed JSON or missing/blank title |
| GET    | `/todos`      | List all todos                                | 200 with JSON array | |
| GET    | `/todos/{id}` | Fetch a single todo                           | 200 with todo | 404 unknown id |
| PUT    | `/todos/{id}` | Full update of title/completed                | 200 with updated todo | 404 unknown id, 400 invalid body |
| DELETE | `/todos/{id}` | Delete a todo                                 | 204 | 404 unknown id |

Unsupported methods on known paths return `405`. All JSON responses set `Content-Type: application/json`.

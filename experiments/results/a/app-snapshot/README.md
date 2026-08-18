# TODO REST API

A small in-memory TODO REST API written in plain Java 21 using
`com.sun.net.httpserver.HttpServer` (no frameworks).

## Build

```sh
mvn -q package
```

## Run

```sh
mvn -q package
java -jar target/todo-api.jar
```

The server listens on port `8080` by default. Set `PORT` to override:

```sh
PORT=9000 java -jar target/todo-api.jar
```

## Test

```sh
mvn -q test
```

## API

All request/response bodies are JSON. A todo has:

```json
{ "id": "string", "title": "string", "completed": false }
```

| Method | Path          | Description                              |
|--------|---------------|-------------------------------------------|
| POST   | `/todos`      | Create a todo from `{"title", "completed"?}`. 201 with the created todo; 400 for malformed JSON or a missing/blank title. |
| GET    | `/todos`      | List all todos. 200 with a JSON array.    |
| GET    | `/todos/{id}` | Get one todo. 200, or 404 if unknown.     |
| PUT    | `/todos/{id}` | Replace title/completed. 200 with the updated todo; 404 if unknown; 400 for an invalid body. |
| DELETE | `/todos/{id}` | Delete a todo. 204, or 404 if unknown.    |

Unsupported methods on a known path return 405. All JSON responses set
`Content-Type: application/json`.

# Todo REST API

A small in-memory TODO REST API written in plain Java 21, using
`com.sun.net.httpserver.HttpServer` (no frameworks).

## Requirements

- Java 21
- Maven 3.6+

## Build

```bash
cd app
mvn -q package
```

## Test

```bash
cd app
mvn -q test
```

## Run

```bash
cd app
mvn -q package
java -jar target/todo-api.jar
```

The server listens on port `8080` by default. Set the `PORT` environment
variable to use a different port:

```bash
PORT=9000 java -jar target/todo-api.jar
```

## API

All request/response bodies are JSON. A todo looks like:

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "title": "Buy milk",
  "completed": false
}
```

| Method | Path         | Description                          | Success | Errors                     |
|--------|--------------|---------------------------------------|---------|-----------------------------|
| POST   | `/todos`     | Create a todo (`title` required)      | 201     | 400 malformed/missing title |
| GET    | `/todos`     | List all todos                        | 200     |                             |
| GET    | `/todos/{id}`| Fetch one todo                        | 200     | 404 unknown id              |
| PUT    | `/todos/{id}`| Full update (`title`, `completed`)    | 200     | 400 invalid body, 404 unknown id |
| DELETE | `/todos/{id}`| Delete a todo                         | 204     | 404 unknown id              |

Unsupported HTTP methods on known paths return `405`. All JSON responses
set `Content-Type: application/json`.

### Example

```bash
curl -X POST localhost:8080/todos -d '{"title":"Buy milk"}'
curl localhost:8080/todos
curl -X PUT localhost:8080/todos/<id> -d '{"title":"Buy milk","completed":true}'
curl -X DELETE localhost:8080/todos/<id>
```

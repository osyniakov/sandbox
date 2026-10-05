/* Kanban board frontend — vanilla JS, talks to /api/* per API_CONTRACT.md */
(function () {
  "use strict";

  var COLUMNS = ["todo", "doing", "done"];

  // Board state: { todo: [Task], doing: [Task], done: [Task] }
  var board = { todo: [], doing: [], done: [] };

  var draggedTaskId = null;
  var placeholder = null;

  // ---------- API helpers ----------

  function api(path, options) {
    return fetch(path, options).then(function (res) {
      if (!res.ok) {
        return res
          .text()
          .catch(function () {
            return "";
          })
          .then(function (body) {
            var msg = "Request failed (" + res.status + ")";
            try {
              var data = JSON.parse(body);
              if (data && data.detail && typeof data.detail === "string") {
                msg += ": " + data.detail;
              }
            } catch (e) {
              /* non-JSON body; keep generic message */
            }
            var err = new Error(msg);
            err.status = res.status;
            throw err;
          });
      }
      if (res.status === 204) {
        return null;
      }
      return res.json();
    });
  }

  function fetchBoard() {
    return api("/api/board").then(function (data) {
      COLUMNS.forEach(function (col) {
        var tasks = (data && data.columns && data.columns[col]) || [];
        tasks.sort(function (a, b) {
          return a.position - b.position;
        });
        board[col] = tasks;
      });
      render();
    });
  }

  function resync() {
    return fetchBoard().catch(function () {
      /* error already shown by caller; avoid unhandled rejection */
    });
  }

  // ---------- Error banner ----------

  var errorBanner = document.getElementById("error-banner");
  var errorMessage = document.getElementById("error-message");

  function showError(msg) {
    errorMessage.textContent = msg;
    errorBanner.hidden = false;
  }

  function hideError() {
    errorBanner.hidden = true;
    errorMessage.textContent = "";
  }

  document
    .getElementById("error-dismiss")
    .addEventListener("click", hideError);

  function handleFailure(err) {
    showError(err && err.message ? err.message : "Something went wrong");
    resync();
  }

  // ---------- Rendering ----------

  function render() {
    COLUMNS.forEach(function (col) {
      var list = document.querySelector('.task-list[data-column="' + col + '"]');
      list.textContent = "";
      board[col].forEach(function (task) {
        list.appendChild(buildCard(task));
      });
      var count = document.querySelector('[data-testid="count-' + col + '"]');
      if (count) {
        count.textContent = String(board[col].length);
      }
    });
  }

  function buildCard(task) {
    var card = document.createElement("div");
    card.className = "card";
    card.setAttribute("data-task-id", task.id);
    card.draggable = true;

    var title = document.createElement("span");
    title.className = "card-title";
    title.textContent = task.title;
    card.appendChild(title);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "card-delete";
    del.setAttribute("data-testid", "delete-task");
    del.setAttribute("aria-label", "Delete task");
    del.textContent = "×";
    card.appendChild(del);

    del.addEventListener("click", function (e) {
      e.stopPropagation();
      deleteTask(task.id);
    });

    title.addEventListener("dblclick", function () {
      startEditing(card, task);
    });

    card.addEventListener("dragstart", function (e) {
      if (card.querySelector(".card-edit-input")) {
        e.preventDefault();
        return;
      }
      draggedTaskId = task.id;
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", task.id);
      } catch (err) {
        /* some engines are picky; the id is tracked in draggedTaskId */
      }
      window.setTimeout(function () {
        card.classList.add("dragging");
      }, 0);
    });

    card.addEventListener("dragend", function () {
      card.classList.remove("dragging");
      draggedTaskId = null;
      removePlaceholder();
      clearDragOverStyles();
    });

    return card;
  }

  // ---------- Add ----------

  var addForm = document.getElementById("add-task-form");
  var addInput = document.getElementById("new-task-title");

  addForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var title = addInput.value.trim();
    if (!title) {
      return;
    }
    api("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title, column: "todo" }),
    })
      .then(function () {
        addInput.value = "";
        return fetchBoard();
      })
      .catch(handleFailure);
  });

  // ---------- Edit ----------

  function startEditing(card, task) {
    var titleEl = card.querySelector(".card-title");
    if (!titleEl) {
      return;
    }

    var input = document.createElement("input");
    input.type = "text";
    input.className = "card-edit-input";
    input.maxLength = 200;
    input.value = task.title;

    card.replaceChild(input, titleEl);
    card.draggable = false;
    input.focus();
    input.select();

    var finished = false;

    function finish(save) {
      if (finished) {
        return;
      }
      finished = true;
      var newTitle = input.value.trim();
      if (!save || newTitle === "" || newTitle === task.title) {
        render(); // restore original card
        return;
      }
      api("/api/tasks/" + encodeURIComponent(task.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      })
        .then(function () {
          return fetchBoard();
        })
        .catch(handleFailure);
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });

    input.addEventListener("blur", function () {
      finish(true);
    });
  }

  // ---------- Delete ----------

  function deleteTask(id) {
    api("/api/tasks/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function () {
        return fetchBoard();
      })
      .catch(handleFailure);
  }

  // ---------- Drag and drop ----------

  function getPlaceholder() {
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "drop-placeholder";
    }
    return placeholder;
  }

  function removePlaceholder() {
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
  }

  function clearDragOverStyles() {
    document.querySelectorAll(".task-list.drag-over").forEach(function (el) {
      el.classList.remove("drag-over");
    });
  }

  function cardsIn(list) {
    return Array.prototype.slice.call(list.querySelectorAll(".card"));
  }

  // The card (excluding the one being dragged) that the pointer is above the
  // vertical midpoint of; the placeholder goes before it. Null → append.
  function cardAfterPointer(list, y) {
    var candidates = cardsIn(list).filter(function (c) {
      return c.getAttribute("data-task-id") !== draggedTaskId;
    });
    for (var i = 0; i < candidates.length; i++) {
      var rect = candidates[i].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return candidates[i];
      }
    }
    return null;
  }

  function findTask(id) {
    for (var i = 0; i < COLUMNS.length; i++) {
      var col = COLUMNS[i];
      for (var j = 0; j < board[col].length; j++) {
        if (board[col][j].id === id) {
          return { task: board[col][j], column: col, index: j };
        }
      }
    }
    return null;
  }

  document.querySelectorAll(".task-list").forEach(function (list) {
    list.addEventListener("dragover", function (e) {
      if (!draggedTaskId) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDragOverStyles();
      list.classList.add("drag-over");

      var after = cardAfterPointer(list, e.clientY);
      var ph = getPlaceholder();
      if (after) {
        list.insertBefore(ph, after);
      } else {
        list.appendChild(ph);
      }
    });

    list.addEventListener("dragleave", function (e) {
      if (e.target === list && !list.contains(e.relatedTarget)) {
        list.classList.remove("drag-over");
      }
    });

    list.addEventListener("drop", function (e) {
      e.preventDefault();
      var id =
        draggedTaskId ||
        (e.dataTransfer ? e.dataTransfer.getData("text/plain") : "");
      var targetColumn = list.getAttribute("data-column");

      // Destination index = number of non-dragged cards before the placeholder
      // (i.e. the final index within the target column after the move).
      var newPosition = 0;
      var ph = placeholder;
      if (ph && ph.parentNode === list) {
        var node = list.firstElementChild;
        while (node && node !== ph) {
          if (
            node.classList.contains("card") &&
            node.getAttribute("data-task-id") !== id
          ) {
            newPosition++;
          }
          node = node.nextElementSibling;
        }
      } else {
        newPosition = cardsIn(list).filter(function (c) {
          return c.getAttribute("data-task-id") !== id;
        }).length;
      }

      removePlaceholder();
      clearDragOverStyles();
      draggedTaskId = null;

      if (!id) {
        return;
      }

      var current = findTask(id);
      if (current && current.column === targetColumn && current.index === newPosition) {
        render(); // nothing moved; just tidy up
        return;
      }

      api("/api/tasks/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ column: targetColumn, position: newPosition }),
      })
        .then(function () {
          return fetchBoard();
        })
        .catch(handleFailure);
    });
  });

  // ---------- Init ----------

  fetchBoard().catch(function (err) {
    showError(err && err.message ? err.message : "Failed to load board");
  });
})();

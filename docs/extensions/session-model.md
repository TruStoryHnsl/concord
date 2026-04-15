# Extension Session Model

**Status:** Proposed 2026-04-15 · completes INS-036 Wave 0 design
**Scope:** stable Concord web client + native shells (`client/src/`, `server/routers/extensions.py`)
**Primary blocker addressed:** replace the current single-blob `com.concord.extension` room state with a structured model that can express shared/private/hybrid surfaces and deterministic input authority.

---

## 1. Problem

Current state shape:

```json
{
  "active": true,
  "extension_id": "worldview",
  "extension_url": "/ext/worldview/",
  "extension_name": "Worldview",
  "host_user_id": "@alice:concord",
  "started_at": 1744130000000
}
```

That is enough for **one** shared iframe in **one** room. It cannot represent:

- more than one surface
- per-user private surfaces
- hybrid shared-TV + private-controller layouts
- read-only vs host-only input
- seat bindings / controller assignment
- launch args / persisted session metadata
- migration/versioning

So INS-036 Waves 1–5 need a new wire contract first.

---

## 2. Decision

Use a **session-first** model with one Matrix room-state event per extension session.

- **Event type:** `com.concord.extension.session`
- **State key:** `<session_id>`
- **Canonical source of truth:** Matrix room state
- **One room may host multiple sessions** over time, but **only one active session per room** in Wave 1 UI. The model allows more later.
- **Ephemeral user actions** are *not* stored in this state object. This document only defines durable session metadata.

Reason:

- state-keyed by `session_id` gives natural history + migration room
- avoids one giant room-global singleton blob
- works with current Matrix sync model
- lets Waves 1–5 layer runtime/action channels on top later without changing session identity

---

## 3. Core object

```json
{
  "version": 1,
  "session_id": "sess_01hrw5v4q7y0k8d9c2m3n4p5q6",
  "extension_id": "worldview",
  "mode": "shared",
  "status": "active",
  "host_user_id": "@alice:concord",
  "created_at": 1744704000000,
  "updated_at": 1744704000000,
  "catalog": {
    "url": "/ext/worldview/",
    "name": "Worldview",
    "icon": "public"
  },
  "launch": {
    "kind": "browser_surface",
    "entry_url": "/ext/worldview/",
    "allow_origin": "self",
    "args": {}
  },
  "surfaces": [],
  "bindings": [],
  "permissions": {
    "host_can_end": true,
    "admins_can_override": true,
    "default_input_policy": "host_only"
  },
  "meta": {
    "title": "Worldview",
    "summary": "Shared interactive world map"
  }
}
```

### Required fields

| Field | Type | Notes |
|---|---|---|
| `version` | integer | starts at `1`; required for migrations |
| `session_id` | string | immutable ID; also matches Matrix state key |
| `extension_id` | string | catalog ID (`worldview`, later games/tools) |
| `mode` | enum | `shared`, `shared_readonly`, `shared_admin_input`, `per_user`, `hybrid` |
| `status` | enum | `active`, `ended` |
| `host_user_id` | string | current host/owner of runtime authority |
| `created_at` | integer | unix ms |
| `updated_at` | integer | unix ms |
| `launch` | object | how shells mount runtime |
| `surfaces` | array | one or more render surfaces |
| `bindings` | array | participant/seat/surface relationship table |
| `permissions` | object | authority defaults |

`catalog` is denormalized on purpose so clients can still render useful UI even if the server catalog changes later.

---

## 4. Modes

### `shared`
Everyone sees same primary surface. Everyone may send input unless surface/binding overrides restrict it.

### `shared_readonly`
Everyone sees same primary surface. Nobody sends input through Concord shell. Good for passive viewers / synchronized playback.

### `shared_admin_input`
Everyone sees same primary surface. Only host/admin bindings may send input.

### `per_user`
Each participant gets separate private surface(s). Shared spectator surface optional but not implied.

### `hybrid`
At least one shared surface plus at least one private/controller surface. This is the party-game / Roll20-companion target.

---

## 5. Surfaces

A **surface** is a render target the Concord shell mounts.

```json
{
  "surface_id": "surf_shared_main",
  "kind": "browser",
  "role": "shared_main",
  "owner_user_id": null,
  "launch_ref": "primary",
  "visible_to": "all",
  "input_policy": "host_only",
  "layout": {
    "region": "main"
  },
  "capabilities": {
    "pointer": true,
    "keyboard": true,
    "resize": true,
    "audio": false
  }
}
```

### Surface fields

| Field | Type | Notes |
|---|---|---|
| `surface_id` | string | immutable inside session |
| `kind` | enum | Wave 0 allows `browser`; later `native`, `canvas`, `video` |
| `role` | enum/string | e.g. `shared_main`, `private_controller`, `spectator`, `tv` |
| `owner_user_id` | string/null | null for shared surfaces |
| `launch_ref` | string | key into launch descriptor set |
| `visible_to` | enum | `all`, `host_only`, `owner_only`, `admins_only`, `bound_users` |
| `input_policy` | enum | `none`, `all`, `host_only`, `admins_only`, `owner_only`, `bound_users` |
| `layout` | object | shell hint only; not authoritative rendering state |
| `capabilities` | object | tells shell which inputs make sense |

### Wave 0 rule

A session must define:

- at least one surface for `shared`, `shared_readonly`, `shared_admin_input`
- at least one owner-bound surface for `per_user`
- at least one shared + one owner-bound surface for `hybrid`

---

## 6. Launch descriptor

Wave 0 only standardizes the **browser surface** launcher.

```json
{
  "kind": "browser_surface",
  "entries": {
    "primary": {
      "url": "/ext/worldview/",
      "allow_origin": "self",
      "persist_profile": false
    },
    "controller": {
      "url": "/ext/worldview/controller",
      "allow_origin": "self",
      "persist_profile": false
    }
  },
  "args": {
    "room_id": "!abc:concord"
  }
}
```

### Rules

- URLs must come from the extension catalog or an allowlisted sub-path of the catalog entry.
- No arbitrary third-party iframe URLs in Wave 0.
- Shell injects session/user metadata later through the bridge SDK boundary from INS-036 Wave 4. Not via query-string sprawl.

---

## 7. Participant bindings

Bindings map users/seats to surfaces and authority.

```json
{
  "binding_id": "bind_alice",
  "user_id": "@alice:concord",
  "seat_id": "seat_host",
  "role": "host",
  "surface_ids": ["surf_shared_main", "surf_host_controller"],
  "input_on": ["surf_shared_main", "surf_host_controller"]
}
```

### Binding fields

| Field | Type | Notes |
|---|---|---|
| `binding_id` | string | stable within session |
| `user_id` | string | Matrix user |
| `seat_id` | string/null | optional logical seat/controller slot |
| `role` | enum | `host`, `admin`, `participant`, `spectator` |
| `surface_ids` | string[] | what this user can see |
| `input_on` | string[] | what this user may control |

Bindings are derived from room membership + host/admin state, but denormalized here so every client resolves authority the same way.

---

## 8. Permission resolution

Input allowed if **all** are true:

1. session `status == active`
2. target surface grants non-`none` input policy
3. binding exists for user
4. binding role matches surface policy
5. later Wave 2 authority layer does not suppress the event

### Policy matrix

| Policy | Allowed users |
|---|---|
| `none` | nobody |
| `all` | any bound participant |
| `host_only` | binding role `host` |
| `admins_only` | `host` or `admin` |
| `owner_only` | surface `owner_user_id` only |
| `bound_users` | explicit `input_on` list |

---

## 9. Matrix wire examples

### 9.1 Shared worldview session

State event:

- type: `com.concord.extension.session`
- state_key: `sess_worldview_room123`

```json
{
  "version": 1,
  "session_id": "sess_worldview_room123",
  "extension_id": "worldview",
  "mode": "shared_admin_input",
  "status": "active",
  "host_user_id": "@alice:concord",
  "created_at": 1744704000000,
  "updated_at": 1744704000000,
  "catalog": {
    "url": "/ext/worldview/",
    "name": "Worldview",
    "icon": "public"
  },
  "launch": {
    "kind": "browser_surface",
    "entries": {
      "primary": {
        "url": "/ext/worldview/",
        "allow_origin": "self",
        "persist_profile": false
      }
    },
    "args": {}
  },
  "surfaces": [
    {
      "surface_id": "surf_main",
      "kind": "browser",
      "role": "shared_main",
      "owner_user_id": null,
      "launch_ref": "primary",
      "visible_to": "all",
      "input_policy": "host_only",
      "layout": { "region": "main" },
      "capabilities": { "pointer": true, "keyboard": true, "resize": true, "audio": false }
    }
  ],
  "bindings": [
    {
      "binding_id": "bind_alice",
      "user_id": "@alice:concord",
      "seat_id": "seat_host",
      "role": "host",
      "surface_ids": ["surf_main"],
      "input_on": ["surf_main"]
    }
  ],
  "permissions": {
    "host_can_end": true,
    "admins_can_override": true,
    "default_input_policy": "host_only"
  },
  "meta": {
    "title": "Worldview",
    "summary": "Shared interactive world map"
  }
}
```

### 9.2 Hybrid party-game session

- shared TV surface visible to all
- private controller surface per user

This is the reference shape for Wave 5 prototype work.

---

## 10. Migration from current model

### Legacy event

- type: `com.concord.extension`
- state key: `""`

### New event

- type: `com.concord.extension.session`
- state key: `<session_id>`

### Migration plan

1. **Server catalog stays unchanged** in Wave 0.
2. Wave 1 client reads **new event first**.
3. If no new event exists, client falls back to legacy singleton parser.
4. Starting a new session writes **only** new-format event.
5. Stopping a new-format session sets `status: ended` and clears active local pointer.
6. Legacy stop path still writes `{ "active": false }` until fallback removed.

No destructive migration required.

---

## 11. Worldview migration target

Worldview becomes the first migrated extension.

### Worldview v1 target

- mode: `shared_admin_input`
- one browser surface
- host owns input by default
- viewers see same map state

That is intentionally simple. It proves:

- session envelope works
- surface manager can mount by descriptor
- authority layer can suppress non-host input

Later Worldview can grow into `hybrid` if it gets host-console or private overlays.

---

## 12. Explicit non-goals for Wave 0

Not in this document:

- postMessage/RPC method names
- per-frame input packets
- audio/video transport
- persistence of extension app internal state
- arbitrary third-party iframe embedding
- multiple simultaneously-active sessions in one room UI

Those belong to later INS-036 waves.

---

## 13. Acceptance checklist

INS-036 Wave 0 is complete when:

- [x] session object defined
- [x] modes defined: `shared`, `shared_readonly`, `shared_admin_input`, `per_user`, `hybrid`
- [x] surface descriptor defined
- [x] participant binding / seat model defined
- [x] launch descriptor defined
- [x] authority resolution rules defined
- [x] migration path from current `com.concord.extension` blob defined
- [x] Worldview migration target defined

---

## 14. Next wave impact

- **Wave 1** builds `SurfaceManager` around `surfaces[]`
- **Wave 2** routes input through `bindings[]` + `input_policy`
- **Wave 3** uses `launch.kind = browser_surface`
- **Wave 4** defines SDK/RPC over this session envelope
- **Wave 5** migrates Worldview + hybrid prototype against this schema

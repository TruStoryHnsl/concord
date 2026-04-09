# Personal Network Subgroups — Design & Justification

**Status:** Resolved 2026-04-08
**Scope:** Concord-side network policy layer that consumes orrtellite's existing flat ACL model. **This doc is NOT a proposal to add nested groups inside orrtellite itself.** Orrtellite stays as-is.
**Answers:** PLAN.md Remaining Design Work #5 (the 2026-04-12 question deferred until after the 2026-04-22 priority batch landed)
**Cross-references:**
- `~/projects/admin/orrtellite/config/acl.yaml` (existing orrtellite ACL — `group:infra`, `group:workstation`, `group:concord`)
- `~/projects/admin/orrtellite/PLAN.md:32` (original user question)
- `reference_orrtellite_tunnel_infra` memory (orrtellite is production-ready Headscale+WireGuard)
- Concord charter/place model (PLAN.md Mesh Network Architecture, Node Verification Protocol)

---

## TL;DR

**Subgroups don't live in orrtellite. They live in Concord's charter layer, and Concord translates them into orrtellite's existing flat groups/tags when enrolling a device into a place's network extension.**

Orrtellite already has everything a personal mesh needs: flat groups (`group:infra`, `group:workstation`, `group:concord`), tags for finer-grained rules (`tag:server`, `tag:desktop`), and Headscale's standard ACL JSON policy. Adding a nested-groups model inside orrtellite is **rejected** — it would bloat orrtellite's architecture with Concord-specific concepts and violate the existing "dependency arrow is one-way: Concord → orrtellite" boundary. Orrtellite stays dumb and flat.

Instead, **Concord places can declare a network extension clause in their charter** that grants members access to a named orrtellite group/tag pair when they join, and revokes it atomically when they leave or are demoted. The "subgroup" is the Concord-layer abstraction of this grant rule. Orrtellite sees only the resulting flat group memberships, which is the shape it already understands.

---

## Context: what orrtellite already does

Orrtellite is a self-hosted Headscale + WireGuard mesh VPN (`~/projects/admin/orrtellite/`). Its current ACL model — visible in `config/acl.yaml` — uses three flat groups mapping to Headscale users:

```yaml
groups:
  group:infra:       [infra]        # orrgate, orrigins, servorr
  group:workstation: [workstation]  # orrion, orrpheus
  group:concord:     [concord]      # concord nodes
  group:all:         [infra, workstation, concord]
```

Plus Tailscale-style device tags (`tag:server`, `tag:desktop`) for finer rules within a group. This is a **standard, proven, maintainable** personal-mesh configuration. It solves the "all devices reach each other over a WireGuard mesh" problem completely.

The question is whether we need something MORE than this — specifically, nested groups or subgroups within a personal network — and the honest answer after working through the use cases is: **not inside orrtellite**. The flat model is sufficient for the VPN layer. What Concord needs is a **higher-level abstraction** that maps Concord-specific concepts (place memberships, charter roles) into orrtellite's flat groups, which is a Concord concern, not an orrtellite concern.

---

## Question 1 — Why are subgroups worthwhile?

The user's original question was about **personal network subgroups** — sub-structure inside one person's own mesh. The honest assessment: for a purely personal mesh (your laptops, phones, home server), flat groups are enough. You don't need "my primary laptops" and "my secondary laptops" as separate groups — either they can reach the home server or they can't, and that's what the existing `group:workstation` + `tag:desktop` model already expresses.

**Subgroups become valuable the moment the mesh is not purely personal.** Specifically:

1. **When the mesh hosts Concord places whose members need scoped network access.** A Concord place might host a shared WebDAV server, a game lobby, a mesh-hosted voice-chat relay, or a distributed compute resource. Granting and revoking access to these resources per-place-member is a real need — and the natural unit is "members of place X," not "all devices on my mesh."

2. **When trust levels are heterogeneous.** "My primary devices" need full access. "Family phones I've added as guests" need read-only to the media server and nothing else. "A friend's laptop visiting for a week" needs access to a specific game lobby and nothing else. These are different trust tiers, and they map cleanly onto group memberships.

3. **When revocation needs to be atomic.** Removing a single guest device requires one operation ("remove from the guest-subgroup") rather than editing every flat rule that referenced the device. This is enough of an ergonomic win that even pure-personal meshes with a few guest slots benefit.

4. **When audit trails need intent.** "Why was this device allowed to reach that service" is a one-step answer when both are in named groups with a declared relationship. In a flat IP-level ACL it's a reverse-engineering exercise.

**The value proposition isn't "subgroups for the sake of subgroups." It's "enough sub-structure to make Concord place integration coherent."** Anything beyond that is complexity for its own sake, which the user has already flagged as unwelcome.

---

## Question 2 — What does flat ACL fail to serve?

Flat ACLs without any group abstraction scale badly (O(N²) rules for N devices across M policies), but orrtellite already has flat groups, not pure IP-level rules. So the relevant comparison is not "flat IP ACL vs subgrouped" — it's "flat GROUP ACL vs subgroup-aware ACL."

Flat group ACL (what orrtellite does today) fails to serve:

1. **Per-place network extensions.** A Concord place has a charter; the charter can declare services the place hosts over the mesh (file exchange, voice relay, game lobby). Granting access to these services to the place's current members requires a way to say "members of charter X get group:place-X-members membership." That mapping is not a thing flat groups express — it's a RULE about HOW to populate the flat group, which lives at a higher layer.

2. **Charter-derived atomicity.** When a user leaves a place or is demoted via charter update, their network access to the place's mesh resources should revoke in lockstep with the Concord-layer state change. Without a Concord-side policy layer, the flat orrtellite group has to be manually kept in sync — which drifts the moment a charter update lands without a matching ACL edit.

3. **Delegation with bounded blast radius.** "Alice can admin the members of place X without touching the rest of the orrtellite ACL" is not expressible in flat orrtellite groups. It requires a place-scoped admin concept, which is a charter concept, which lives on the Concord side.

4. **TTL'd memberships tied to Concord semantics.** A guest who joined a Concord place for a 1-week event should have their network grant auto-expire when the event ends — without manual cleanup. The TTL lives on the charter's event schedule, not on the orrtellite ACL.

5. **Intent preservation across personas.** "This group exists because place X exists" is load-bearing context. If the place is deleted, its orrtellite group should be cleaned up automatically. Flat ACLs have no concept of "this group's lifecycle is tied to this place's lifecycle."

None of these require NESTED groups in orrtellite. They require a **Concord-side mapping layer** that writes flat groups into orrtellite's ACL in response to charter state changes. That's the design.

---

## Question 3 — How does this interact with the charter / place model?

Concord's place/charter model (from PLAN.md Mesh Network Architecture):

- Places are mesh-addressed entities with charters.
- Charters have owner signatures, governance rules, membership roles.
- Charters are immutable except via owner-signed updates with a monotonic version counter (see "Charter immutability" in PLAN.md Open Conflicts).
- Roles determine what a member can do inside the place; the charter defines the role→permission map.

### Proposed: charter `network` extension clause

A charter can optionally declare a **network extension** — a named policy that says "members of this role get this kind of network access when they join." The charter does NOT contain IP addresses or orrtellite-specific config. It contains role→capability mappings that the Concord-side adapter translates into orrtellite ACL edits.

Rough shape:

```toml
[place]
id = "place-<uuid>"
name = "Example Place"
version = 5
# ... existing charter fields ...

[place.network]
# Required: a machine-readable name for the orrtellite group this place
# will write into. Must be unique across Concord places.
orrtellite_group = "concord-place-<placeid>-members"

# Required: which concord charter role grants what capability
[place.network.role_grants]
owner      = ["admin", "read", "write"]
moderator  = ["read", "write"]
member     = ["read"]
guest      = []   # no network access

# Optional: TTL for guest memberships (hours). Default: no TTL.
guest_ttl_hours = 168  # 7 days

# Optional: which mesh services this place exposes to its members.
# These become tag:service rules in orrtellite.
[[place.network.service]]
name = "voice-relay"
host = "voice.place-<placeid>.concord"
ports = ["3478/udp", "443/tcp"]

[[place.network.service]]
name = "shared-files"
host = "files.place-<placeid>.concord"
ports = ["443/tcp"]
```

### Adapter behavior

The Concord-side adapter (call it `concord-orrtellite-adapter` — a small daemon or a concord-api module, NOT part of orrtellite) watches charter state changes and writes flat orrtellite ACL edits:

1. **On place creation with a network clause:**
   - Create the flat orrtellite group `concord-place-<placeid>-members` (empty).
   - Write ACL rules that grant `group:concord-place-<placeid>-members` access to the declared services.
   - Apply via `headscale policy set`.

2. **On member join:**
   - Resolve the member's Concord user → their orrtellite user mapping (a lookup table maintained by concord-api).
   - Add the user to `concord-place-<placeid>-members` via Headscale API.
   - Note the join in the adapter's local ledger for audit.

3. **On member leave / demote / role change:**
   - Remove / update the user's group memberships atomically via Headscale API.
   - Tombstone the change in the adapter ledger.

4. **On charter update (new version):**
   - Diff old vs new charter's network clause.
   - Apply only the delta (add/remove/change services, role grants, TTL).
   - Respect the monotonic version counter — reject updates where the counter didn't advance.

5. **On place deletion:**
   - Remove all ACL rules tied to the place.
   - Delete the orrtellite group.

### Interaction with charter immutability

Charter immutability is the load-bearing invariant — without it, a compromised admin could silently rewrite the grants that expose a user's devices to a place's network. The existing "owner-signed + monotonic version counter" rule (from PLAN.md Open Conflicts item 2 and the `remint_place()` code path) protects the network extension clause the same way it protects everything else in the charter.

Specifically:
- A charter update that changes `role_grants` requires the same owner signature as any other charter update.
- The version counter prevents replay attacks — you can't re-inject an old grant rule because the counter has already advanced past it.
- The adapter ONLY applies the current charter version's network clause, never replays history.

### Interaction with the two-tier trust model

From the `project_v2_node_verification` memory: "Two-tier trust: tunnels=high-perm exchange, P2P/cluster=speculative only. Servers verify."

The network extension clause maps onto the **tunnel tier** exclusively:
- Network access is a high-permission grant, so it flows through verified tunnels (orrtellite), not P2P/cluster gossip.
- A speculative (cluster-tier) member of a place does NOT receive orrtellite group membership until they are promoted to a verified tunnel-tier relationship.
- Disposable anonymous nodes (private browsing mode, per `project_v2_anonymous_browsing`) NEVER receive network extension grants — they're speculative by design.

### Privacy boundary

Place membership is mesh-visible (you can see that @alice is in place X via the charter's public member list). Network extension grants are **derived** from place membership, so they are not MORE private than the underlying join — but the adapter still treats group membership as local/private state on the orrtellite control plane, not published back to the Concord mesh map. The mesh map shows "at-least-some-level presence" without exposing which orrtellite subgroups a user belongs to.

---

## Non-goals

- **Nested orrtellite groups.** Orrtellite stays flat. No `group:concord > group:concord-place-X > group:concord-place-X-moderators` hierarchy. The Concord adapter writes flat, uniquely-named groups per place.
- **Personal subgroups inside purely-personal orrtellite use.** If you just want to segment your own devices, use existing tags (`tag:server`, `tag:desktop`). That's what they're for.
- **Cross-place grants.** A user in place X does NOT automatically get access to place Y's services. Every place's network extension is independently scoped.
- **Network extensions without charter.** You cannot grant orrtellite access via any path that bypasses the charter. The charter is the source of truth.
- **Orrtellite modifications.** Orrtellite code stays frozen at its current design. All subgroup logic lives in Concord's adapter.
- **Tailscale parity.** Tailscale's ACL model is what it is; orrtellite inherits Headscale's fork of that model. We don't extend either with new primitives.

---

## Risks and trade-offs

1. **Group name collision.** Two Concord places with similar IDs could produce colliding orrtellite group names. Mitigation: name scheme `concord-place-<full-uuid>-members` uses full UUIDs to prevent collision.
2. **Adapter single-point-of-failure.** If the adapter daemon is offline, new joins don't propagate to orrtellite. Mitigation: the adapter is stateless (reads charter state from the Concord mesh, writes flat groups to Headscale) and can be restarted at will. A missed join results in a delayed grant, not a permanent failure — next adapter run catches up.
3. **Headscale API rate limits.** Mass role changes in a large place could spam Headscale. Mitigation: batch updates via `headscale policy set` with the full policy payload instead of per-user API calls.
4. **Charter bloat.** Not every place needs a network extension. Mitigation: the `[place.network]` clause is optional. A place with no network clause has no orrtellite impact at all.
5. **Adapter privilege.** The adapter needs write access to Headscale's policy and user-group mappings. Mitigation: the adapter runs as a dedicated Headscale admin user (`concord-adapter`) with only the specific API permissions it needs (policy read/write, user group edit). Not the root admin.

---

## Open questions (non-blocking — tracked for Phase 1 of the adapter implementation)

1. **Consent model for network extension grants.** When a user joins a place, should the Concord client prompt them "this place wants to grant your device network access — allow?" or is place-level consent sufficient? Lean toward **explicit per-join prompt on first access**, remembered for subsequent joins.
2. **Orrtellite user → Concord user mapping.** The adapter needs a lookup. Where does it live? Proposal: a concord-api table `user_mesh_identity` mapping `concord_user_id → orrtellite_user` plus the set of devices enrolled. Populated lazily when a user first joins a place with a network extension.
3. **Revocation latency target.** When a user is demoted/banned from a place, how quickly must orrtellite reflect it? Proposal: under 10 seconds for normal flows, under 1 second for security events (explicit ban). Adapter should expose a `revoke_now` API for the ban case.
4. **TTL expiration mechanism.** Polling the charter TTL vs scheduling a per-guest expiry. Proposal: a simple periodic sweep every 60 seconds finds expired guest memberships and revokes them. Not precise, but bounded.
5. **Audit log persistence.** Should the adapter's ledger of grants/revocations be part of Concord's main audit log or a separate store? Proposal: a separate table `mesh_access_ledger` in concord-api's DB, joined to the main audit log by place ID.

---

## Implementation plan (if/when this is built)

**Phase 0 (now):** this doc. Decision locked in. Orrtellite stays as-is.

**Phase 1:** Implement the charter `network` extension clause schema on the Concord side. Validate it in the charter parser. No adapter yet — just the schema + validation + storage.

**Phase 2:** Build the `concord-orrtellite-adapter` — a small daemon or concord-api module that watches charter events and writes flat orrtellite groups via the Headscale API. Start with a single place, manual invocation, exhaustive logging.

**Phase 3:** Hook the adapter into the real charter event stream. Run in shadow mode for a week — log what it WOULD do without actually writing to orrtellite.

**Phase 4:** Enable writes. Start with one real test place. Monitor for drift between charter state and orrtellite state for a week.

**Phase 5:** Generalize. Let any place declare a network extension. Expose a minimal admin UI in concord-api.

The phased approach lets us catch drift, adapter bugs, and charter-parser edge cases before they touch production orrtellite state.

---

## Decision

**Adopt the Concord-layer adapter model. Reject the orrtellite-layer nesting model.**

The "subgroups" question has a clean answer: they live in Concord, as a charter concept, and the Concord-to-orrtellite adapter translates them into the flat groups orrtellite already understands. Orrtellite stays architecturally simple. Concord owns the semantics of "who gets network access to what," which is where that semantic naturally belongs.

No orrtellite code changes. Phase 0 (this doc) is done. Phase 1 is ready when the broader mesh charter work in `concord_beta/` reaches the point where places have real network services to expose.

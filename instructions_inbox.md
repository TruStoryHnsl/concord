
---

## Instruction (2026-04-07T01:09:52Z)

### INS-001: Fix channel label truncation from adjacent buttons
Channel labels in the sidebar are being obscured by nearby buttons at reasonable pane widths. Adjust layout so labels only truncate/ellipsize when the user drags the pane nearly on top of the label text. Ensure buttons do not overlay label area at default widths.

### INS-002: Drag-to-reorder channels and servers
Implement drag-and-drop reordering for both channels (within a server) and servers (within the server list). Persist new order to backend.

### INS-003: Redesign channel tiles with inline controls and double-click rename
Move channel action controls from side buttons into the channel tile itself. Add double-click handler on channel tile to trigger inline rename.

### INS-004: Move channel add/delete UI to admin panel
Remove add-channel and delete-channel controls from the channel sidebar. Relocate them to the admin panel. This frees sidebar space for full channel label display.

### INS-005: Show notification badges on currently-selected channel
Notification badges are currently hidden when a channel is selected. Render badges on selected channels as well, so incoming messages are visible without switching away.

### INS-006: Mark messages as read in real time while viewing chat
Messages received while the user is actively viewing a chat are incorrectly flagged unread on channel switch. Mark messages as read immediately upon arrival if their channel is currently focused, so switching away does not resurface already-seen messages.

### INS-007: Green presence badge on servers with active users
Display a green badge on server tiles when one or more users are currently active on that server. Suppress the badge for servers marked private.

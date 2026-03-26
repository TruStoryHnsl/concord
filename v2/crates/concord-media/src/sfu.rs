// Selective Forwarding Unit (SFU) module.
//
// Responsibilities:
// - Route media tracks between participants without transcoding
// - Manage subscriptions: which participant receives which tracks
// - Handle track add/remove as participants join/leave
// - Implement last-N speaker selection for large channels
// - Backbone nodes can act as SFU relays for bandwidth efficiency

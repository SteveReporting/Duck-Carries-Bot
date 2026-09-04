# Active Carries Feed

`#active-carries` is the public, read-only live session surface.

- One editable card per in-progress carry session.
- Shows dungeon, difficulty, Carrier, live run counter, requester progress, participant count and optional voice.
- `End Run +1` is Carrier/staff only and updates only the public live counter.
- Verified carry completion and service-time accounting remain authoritative in the private carry ticket.
- `Join Carry` reuses the existing safe drop-in flow and never exposes private ticket notes.
- Ended sessions are removed from the public feed automatically.
- The reconciler limits Discord mutations per pass so large servers do not hammer rate limits.

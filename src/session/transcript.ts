import { LiveCallUtterance } from "../types";

// Arrival order breaks time_sec ties: the orchestrator emits causally (a
// node_transition before the response in the new node), so insertion order
// beats sorting by id.
type Stored = LiveCallUtterance & { seq: number };

// Snapshot and deltas both land here; an id seen again overwrites in place (a
// partial utterance growing into its final text) instead of duplicating.
export class TranscriptStore {
  private items = new Map<string, Stored>();
  private preSession = new Map<string, Stored>();
  private seq = 0;

  // Returns the conversation items never seen before, so one-shot signals
  // (a node transition) fire once even though the item is re-sent as it
  // grows. Pre-session tool calls carry none of those.
  public merge(
    transcripts: LiveCallUtterance[] | undefined,
    preSessionTranscripts: LiveCallUtterance[] | undefined,
  ): LiveCallUtterance[] {
    const fresh = this.mergeInto(this.items, transcripts);
    this.mergeInto(this.preSession, preSessionTranscripts);
    return fresh;
  }

  public get transcript(): LiveCallUtterance[] {
    return sorted(this.items);
  }

  // Tool calls that ran before the agent's first message. Kept apart from
  // `transcript`: their timestamps are on a separate clock, so a merged sort
  // would interleave them into the conversation.
  public get preSessionTranscript(): LiveCallUtterance[] {
    return sorted(this.preSession);
  }

  private mergeInto(
    target: Map<string, Stored>,
    incoming: LiveCallUtterance[] | undefined,
  ): LiveCallUtterance[] {
    const fresh: LiveCallUtterance[] = [];
    if (!incoming) return fresh;
    for (const item of incoming) {
      const existing = target.get(item.id);
      if (!existing) fresh.push(item);
      target.set(item.id, { ...item, seq: existing?.seq ?? this.seq++ });
    }
    return fresh;
  }
}

function sorted(items: Map<string, Stored>): LiveCallUtterance[] {
  return Array.from(items.values())
    .sort((a, b) => a.time_sec - b.time_sec || a.seq - b.seq)
    .map(({ seq, ...rest }) => rest as LiveCallUtterance);
}

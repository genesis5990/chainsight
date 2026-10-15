/**
 * Belief event fan-out over Postgres (belief.case_stream).
 *
 * Replaces Redis pub/sub. publish() appends a 'beliefs' row for the case;
 * subscribe() tails new rows. Subscribers receive live events only and
 * should backfill older ones from belief.events (v1.1 §3.10).
 */
import type { BeliefStateEvent, CaseId, CaseStream } from '@chainsight/shared-types';

export interface PubSubOptions {
  stream: CaseStream;
}

const TOPIC = 'beliefs';

export class BeliefPubSub {
  private readonly stream: CaseStream;

  constructor(opts: PubSubOptions) {
    this.stream = opts.stream;
  }

  /** Never throws: fan-out failure must not abort the calling write. */
  async publish(caseId: CaseId, event: BeliefStateEvent): Promise<number> {
    return this.stream.append(caseId, TOPIC, null, event);
  }

  /** Async iterator over new belief events for a case, until the signal aborts. */
  async *subscribe(caseId: CaseId, signal?: AbortSignal): AsyncIterable<BeliefStateEvent> {
    for await (const row of this.stream.tail({ case_id: caseId, topics: [TOPIC], signal })) {
      yield row.payload as BeliefStateEvent;
    }
  }
}

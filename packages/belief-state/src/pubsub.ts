/**
 * Redis pub/sub publisher + subscriber for BeliefStateEvent.
 *
 * Channel naming: `case:{case_id}:beliefs:{namespace}`
 * Subscribers should receive a `snapshot_marker` event first so they can
 * backfill any older events from the events table (v1.1 §3.10).
 */

import type Redis from 'ioredis';
import type { BeliefStateEvent, CaseId } from '@chainsight/shared-types';

export interface PubSubOptions {
  publisher: Redis;
  subscriber?: Redis;       // separate connection for subscribe — required for ioredis
  namespace?: string;
}

export class BeliefPubSub {
  private readonly publisher: Redis;
  private readonly subscriber?: Redis;
  private readonly ns: string;

  constructor(opts: PubSubOptions) {
    this.publisher = opts.publisher;
    this.subscriber = opts.subscriber;
    this.ns = opts.namespace ?? 'dev';
  }

  channel(caseId: CaseId): string {
    return `case:${caseId}:beliefs:${this.ns}`;
  }

  async publish(caseId: CaseId, event: BeliefStateEvent): Promise<number> {
    try {
      return await this.publisher.publish(this.channel(caseId), JSON.stringify(event));
    } catch (e) {
      // Pub/sub publish failures must not abort the calling DB transaction.
      // Log and swallow.
       
      console.warn('[belief.pubsub] publish failed', { caseId, e });
      return 0;
    }
  }

  /**
   * Async iterator over events for a case. The caller MUST call dispose()
   * (or break out of the for-await loop) to free the subscription.
   */
  async *subscribe(caseId: CaseId, signal?: AbortSignal): AsyncIterable<BeliefStateEvent> {
    if (!this.subscriber) {
      throw new Error('[belief.pubsub] subscribe() requires a subscriber connection');
    }
    const channel = this.channel(caseId);
    const queue: BeliefStateEvent[] = [];
    let resolveNext: ((v: void) => void) | null = null;
    let closed = false;

    const handler = (chan: string, msg: string) => {
      if (chan !== channel) return;
      try {
        queue.push(JSON.parse(msg) as BeliefStateEvent);
      } catch {
        // skip malformed message
        return;
      }
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    };

    await this.subscriber.subscribe(channel);
    this.subscriber.on('message', handler);

    const onAbort = async () => {
      closed = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
      while (!closed) {
        while (queue.length > 0) {
          const ev = queue.shift()!;
          yield ev;
        }
        if (closed) break;
        await new Promise<void>((res) => { resolveNext = res; });
      }
    } finally {
      this.subscriber.off('message', handler);
      try { await this.subscriber.unsubscribe(channel); } catch { /* noop */ }
    }
  }
}

/**
 * ChainSight worker — BullMQ-based job processor.
 *
 * Phase 0 Week 1: empty skeleton with a hello-world job for end-to-end smoke testing.
 * Phase 0 Week 3+: Tracer Agent jobs, document extraction, wallet analysis kickoff.
 */
import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';

const log = pino({ name: 'chainsight-worker', level: process.env.LOG_LEVEL ?? 'info' });
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const HELLO_QUEUE = 'hello-world';

// Outbound producer (other apps can import this pattern)
export const helloQueue = new Queue(HELLO_QUEUE, { connection });

// Inbound consumer
const worker = new Worker(
  HELLO_QUEUE,
  async (job) => {
    log.info({ id: job.id, name: job.name, data: job.data }, 'processing job');
    return { processedAt: new Date().toISOString() };
  },
  { connection },
);

worker.on('completed', (job, result) => {
  log.info({ id: job.id, result }, 'job completed');
});

worker.on('failed', (job, err) => {
  log.error({ id: job?.id, err }, 'job failed');
});

log.info('ChainSight worker started');

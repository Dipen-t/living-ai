import type { PlannerProvider } from '@evolvekit/ai';
import type { EvolutionService } from './service';

/** A single local consumer. PostgreSQL leases allow additional processes to run safely. */
export function startPlannerWorker(
  service: EvolutionService,
  provider: PlannerProvider,
  onError: () => void,
  intervalMs = 1000,
) {
  const shutdown = new AbortController();
  let task: Promise<void> | null = null;
  const tick = () => {
    if (task || shutdown.signal.aborted) return;
    task = service
      .runPlannerOnce(provider, { signal: shutdown.signal })
      .then(
        () => {},
        () => onError(),
      )
      .finally(() => {
        task = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    shutdown.abort();
    clearInterval(timer);
    await task;
  };
}

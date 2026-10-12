import { createDemoApi } from './app';
import { GeminiPlanner, LocalRulesPlanner } from '@evolvekit/ai';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');
const plannerMode = process.env.EVOLVEKIT_PLANNER ?? 'local';
if (!['local', 'gemini'].includes(plannerMode))
  throw new Error('EVOLVEKIT_PLANNER must be local or gemini.');
const planner =
  plannerMode === 'gemini'
    ? process.env.GEMINI_API_KEY
      ? new GeminiPlanner({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL })
      : undefined
    : new LocalRulesPlanner();
if (!planner)
  console.warn(
    'Gemini is unconfigured. Set GEMINI_API_KEY in the server .env. Active configurations and guided proposals remain available.',
  );
const { app } = await createDemoApi({
  databaseUrl: process.env.DATABASE_URL,
  sessionSecret: process.env.DEMO_SESSION_SECRET,
  logger: true,
  plannerMode: plannerMode as 'local' | 'gemini',
  planner,
});
// The identity switcher is a local testing fixture. Never expose this demo API as production authentication.
await app.listen({ host: '127.0.0.1', port: 3040 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });

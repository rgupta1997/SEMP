import { Link } from 'react-router-dom';
import { GUIDES, PORTAL_TOUR } from '../lib/onboarding';
import { Button, Card, CardBody, PageHeader } from '../components/ui';
import { useTour } from '../components/onboarding/Tour';

// "How to use this portal" — the same step content as the dashboard checklists,
// grouped by audience, always available from the nav. Passive companion to the
// data-driven checklist (which nudges you through your own next step).
export function HelpPage() {
  const tour = useTour();
  return (
    <div className="space-y-6">
      <PageHeader title="Help & guide" subtitle="Learn how to run your organization or championship, step by step.">
        <Button variant="outline" onClick={() => tour.start(PORTAL_TOUR)}>Take a 1-min tour</Button>
      </PageHeader>

      <Card className="border-brand-200 bg-brand-50/60 dark:border-brand-500/30 dark:bg-brand-500/10">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            New here? The fastest way to learn is by doing — your dashboard shows a <b>Getting started</b> checklist that tracks your real progress and links each next step.
          </p>
        </CardBody>
      </Card>

      {GUIDES.map((g) => (
        <Card key={g.audience}>
          <CardBody>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{g.audience}</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{g.blurb}</p>
            <ol className="mt-4 space-y-3">
              {g.steps.map((s, i) => (
                <li key={s.id} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">{i + 1}</span>
                  <div>
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">{s.title}</div>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{s.help}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardBody>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">For officials & players</h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-400">
            <li><b>Officials</b> — assigned matches appear under <Link to="/officiating" className="text-brand-600 hover:underline dark:text-brand-300">Officiating</Link>; open a fixture to score it live.</li>
            <li><b>Players</b> — once a captain adds you to a squad, your matches and results show up under <Link to="/profile" className="text-brand-600 hover:underline dark:text-brand-300">My Game</Link>.</li>
            <li><b>Captains</b> — you can manage your own team’s squad from the team page, even without being an organization admin.</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

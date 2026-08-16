import { Link, useParams } from 'react-router-dom';
import { History, Layers, Lock, Mail, ToggleLeft, type LucideIcon } from 'lucide-react';
import { PageHeader, Card } from '../../components/ui';

// One Administration entry in the sidebar rather than four (J1-E7-S1).
//
// Roles, modules, structure, invitations and the activity trail are all "how this
// institution is set up", and a person looking for any of them is looking for the same
// thing. Four sibling nav items made the operating sections - People, Teams, Events -
// harder to find, which is the opposite of what navigation is for.

const SECTIONS: Array<{ to: string; label: string; blurb: string; icon: LucideIcon }> = [
  { to: 'structure', label: 'Structure', icon: Layers,
    blurb: 'Programmes and batches — the shape your institution actually has, so people can be placed in it.' },
  { to: 'roles', label: 'Roles & permissions', icon: Lock,
    blurb: 'What each role can do here. Grant a permission and it widens access immediately; no code change involved.' },
  { to: 'modules', label: 'Modules', icon: ToggleLeft,
    blurb: 'Which sections staff and students can each reach. Switching one off hides it everywhere, including direct links.' },
  { to: 'invitations', label: 'Invitations', icon: Mail,
    blurb: 'Bring colleagues in by email address, before they have an account.' },
  { to: 'activity', label: 'Activity', icon: History,
    blurb: 'Every consequential action, in plain English. Entries can never be edited or removed — not even by a platform admin.' },
];

export function OrgAdministrationPage() {
  const { orgId } = useParams();
  return (
    <div className="grid gap-5">
      <PageHeader title="Administration" subtitle="How this institution is set up and who can do what." />
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(({ to, label, blurb, icon: Icon }) => (
          <Link key={to} to={`/organizations/${orgId}/${to}`} className="group">
            <Card interactive className="h-full p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Icon size={17} aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 group-hover:underline dark:text-slate-200">{label}</div>
                  <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{blurb}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

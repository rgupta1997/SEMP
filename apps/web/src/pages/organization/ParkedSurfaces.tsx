import { WorkInProgress } from '../../components/WorkInProgress';

// Three epics whose API is built, tested and reachable, but whose screen is parked.
// Each says what already works so the reader knows this is a scheduling decision.

// Both show just the heading; the API behind each is built (J5-E4 benchmark, J5-E5 report).
export const OrgBenchmarkPage = ({ inline }: { inline?: boolean }) => (
  <WorkInProgress
    title={inline ? undefined : 'Peer benchmark'}
    subtitle="How this institution compares with others, without naming any of them."
    whatWorks="See how your institution compares with others, anonymously. Coming soon."
  />
);

export const OrgImpactReportPage = ({ inline }: { inline?: boolean }) => (
  <WorkInProgress
    title={inline ? undefined : 'Annual sports impact report'}
    subtitle="The year, assembled into something an institution can publish."
    whatWorks="Your year in sport, in one report you can share. Coming soon."
  />
);

export const EventStatusReportPage = () => (
  <WorkInProgress
    title="Operational status report"
    subtitle="Where a championship actually stands, mid-run."
    epic="J2-E8 · Operational status report"
    whatWorks={
      <>
        The figures are built and tested - fixtures played against scheduled, results
        locked against pending, and what is blocking the rest. What is not built yet is
        this screen.
      </>
    }
  />
);

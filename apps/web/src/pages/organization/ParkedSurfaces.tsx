import { WorkInProgress } from '../../components/WorkInProgress';

// Three epics whose API is built, tested and reachable, but whose screen is parked.
// Each says what already works so the reader knows this is a scheduling decision.

export const OrgBenchmarkPage = ({ inline }: { inline?: boolean }) => (
  <WorkInProgress
    title={inline ? undefined : 'Peer benchmark'}
    subtitle="How this institution compares with others, without naming any of them."
    epic="J5-E4 · Anonymised peer benchmark"
    whatWorks={
      <>
        The benchmark itself is built and tested: it is opt-in per institution, excludes
        your own numbers from the cohort you are compared against, and suppresses any
        cohort too small to stay anonymous. What is not built yet is this screen.
      </>
    }
  />
);

export const OrgImpactReportPage = ({ inline }: { inline?: boolean }) => (
  <WorkInProgress
    title={inline ? undefined : 'Annual sports impact report'}
    subtitle="The year, assembled into something an institution can publish."
    epic="J5-E5 · Annual Sports Impact Report"
    whatWorks={
      <>
        The report is built and tested: it composes the participation, performance and
        inclusion figures for a season and runs as a job, because assembling a year does
        not fit inside a single request. What is not built yet is this screen.
      </>
    }
  />
);

export const EventStatusReportPage = () => (
  <WorkInProgress
    title="Operational status report"
    subtitle="Where a championship actually stands, mid-run."
    epic="J2-E8 · Operational status report"
    whatWorks={
      <>
        The figures are built and tested — fixtures played against scheduled, results
        locked against pending, and what is blocking the rest. What is not built yet is
        this screen.
      </>
    }
  />
);

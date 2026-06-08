export function ChallengePanel({ runId }: { runId: string | null }) {
  return <div>Challenge {runId ?? ''}</div>;
}

import { afterEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class { async send(cmd: { input: unknown }) { sent.push(cmd.input); return {}; } },
  InvokeCommand: class { constructor(public input: unknown) {} },
}));

const { isEventSetupJobEvent, startApplyJob } = await import('./apply-job.js');

afterEach(() => { delete process.env.AWS_LAMBDA_FUNCTION_NAME; sent.length = 0; });

describe('isEventSetupJobEvent', () => {
  it('recognises only the apply job payload', () => {
    expect(isEventSetupJobEvent({ eventSetupJob: { kind: 'apply', setupId: 's1', actorId: 'u1' } })).toBe(true);
    expect(isEventSetupJobEvent({ version: '2.0', routeKey: '$default', rawPath: '/api/health' })).toBe(false);
    expect(isEventSetupJobEvent({ eventSetupJob: { kind: 'undo', setupId: 's1' } })).toBe(false);
    expect(isEventSetupJobEvent(null)).toBe(false);
  });
});

describe('startApplyJob', () => {
  it('runs the job in this process when not on Lambda', async () => {
    const runLocal = vi.fn();
    await startApplyJob({} as never, 's1', 'u1', runLocal);
    expect(runLocal).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it('on Lambda, invokes this same function asynchronously with the job and nothing else', async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = 'semp-api';
    const runLocal = vi.fn();
    await startApplyJob({} as never, 's1', 'u1', runLocal);
    expect(runLocal).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const input = sent[0] as { FunctionName: string; InvocationType: string; Payload: Uint8Array };
    expect(input.FunctionName).toBe('semp-api');
    expect(input.InvocationType).toBe('Event');
    expect(JSON.parse(new TextDecoder().decode(input.Payload))).toEqual({ eventSetupJob: { kind: 'apply', setupId: 's1', actorId: 'u1' } });
  });
});

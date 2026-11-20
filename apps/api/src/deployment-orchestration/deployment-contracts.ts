export const DEPLOYMENT_TRIGGER_QUEUE = "deployment-triggers";
export const DEPLOYMENT_TRIGGER_JOB = "dispatch-deployment-trigger";

export interface DeploymentTriggerJob {
  requestId: string;
  projectId: string;
  releaseId: string;
  environmentId: string;
  idempotencyKey: string;
  reason: string | null;
}

export interface DeploymentTriggerQueue {
  add(
    name: string,
    data: DeploymentTriggerJob,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
      removeOnComplete: number;
      removeOnFail: number;
    },
  ): Promise<unknown>;
}

export const DEPLOYMENT_TRIGGER_QUEUE_PROVIDER = Symbol(
  "DEPLOYMENT_TRIGGER_QUEUE_PROVIDER",
);

export const DEPLOYMENT_TRIGGER_JOB_DEFAULTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 1_000,
};

export type QueueJob = {
  id?: string;
  data?: any;
  attemptsMade: number;
  failedReason?: string;
  finishedOn?: number;
  getState(): Promise<string>;
  retry(): Promise<void>;
};

export interface IntegrationOperationsQueue {
  getJobs(
    types: string[],
    start: number,
    end: number,
    ascending?: boolean,
  ): Promise<QueueJob[]>;
  getJob(id: string): Promise<QueueJob | null>;
}

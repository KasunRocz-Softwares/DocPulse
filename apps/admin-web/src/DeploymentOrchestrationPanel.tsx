import { useCallback, useEffect, useState } from "react";
import { adminApi } from "./api";

type Environment = {
  id: string;
  name: string;
  label?: string | null;
  enabled: boolean;
};
type Policy = {
  environmentId: string;
  enabled: boolean;
  requireApprovedRelease: boolean;
};
type TriggerRequest = {
  id: string;
  environmentId: string;
  status: string;
  reason?: string | null;
  resultCode?: string | null;
  resultSummary?: string | null;
  requestedAt: string;
};

const transitions: Record<string, string[]> = {
  REQUESTED: ["ACCEPTED", "RUNNING", "FAILED", "CANCELLED"],
  ACCEPTED: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SUCCEEDED", "FAILED", "CANCELLED"],
};

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Deployment request could not be completed.";

export function DeploymentOrchestrationPanel({
  projectId,
  releaseId,
}: {
  projectId: string;
  releaseId: string;
}) {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [policies, setPolicies] = useState<Record<string, Policy>>({});
  const [requests, setRequests] = useState<TriggerRequest[]>([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [environmentResult, requestResult] = await Promise.allSettled([
      adminApi.listEnvironments<Environment[]>(projectId),
      adminApi.listDeploymentTriggerRequests<TriggerRequest[]>(
        projectId,
        releaseId,
      ),
    ]);
    if (environmentResult.status === "fulfilled") {
      const nextEnvironments = environmentResult.value;
      setEnvironments(nextEnvironments);
      setEnvironmentId((current) =>
        nextEnvironments.some((environment) => environment.id === current)
          ? current
          : (nextEnvironments[0]?.id ?? ""),
      );
      const policyResults = await Promise.allSettled(
        nextEnvironments.map((environment) =>
          adminApi.getDeploymentPolicy<Policy>(projectId, environment.id),
        ),
      );
      const nextPolicies: Record<string, Policy> = {};
      policyResults.forEach((result, index) => {
        if (result.status === "fulfilled")
          nextPolicies[nextEnvironments[index]!.id] = result.value;
      });
      setPolicies(nextPolicies);
      const policyError = policyResults.find(
        (result) => result.status === "rejected",
      );
      if (policyError?.status === "rejected")
        setError(errorMessage(policyError.reason));
    } else {
      setError(errorMessage(environmentResult.reason));
    }
    if (requestResult.status === "fulfilled") setRequests(requestResult.value);
    else
      setError((current) =>
        [current, errorMessage(requestResult.reason)].filter(Boolean).join(" "),
      );
  }, [projectId, releaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePolicy(environment: Environment) {
    const policy = policies[environment.id];
    if (!policy) return;
    setWorking(`policy:${environment.id}`);
    setError("");
    setNotice("");
    try {
      const updated = await adminApi.setDeploymentPolicy<Policy>(
        projectId,
        environment.id,
        {
          enabled: policy.enabled,
          requireApprovedRelease: policy.requireApprovedRelease,
        },
      );
      setPolicies((current) => ({ ...current, [environment.id]: updated }));
      setNotice(
        `Deployment policy saved for ${environment.label || environment.name}.`,
      );
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setWorking("");
    }
  }

  async function createRequest() {
    if (!environmentId) return;
    setWorking("request");
    setError("");
    setNotice("");
    try {
      await adminApi.createDeploymentTriggerRequest(
        projectId,
        releaseId,
        { environmentId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
        crypto.randomUUID(),
      );
      setReason("");
      setNotice(
        "Deployment request recorded. A connected runner must accept it before execution.",
      );
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setWorking("");
    }
  }

  async function updateRequest(requestId: string, status: string) {
    setWorking(requestId);
    setError("");
    setNotice("");
    try {
      await adminApi.updateDeploymentTriggerStatus(projectId, requestId, {
        status,
      });
      setNotice(`Deployment request moved to ${status.toLowerCase()}.`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setWorking("");
    }
  }

  return (
    <section
      className="section-block deployment-orchestration"
      aria-labelledby="deployment-orchestration-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="deployment-orchestration-title">Governed deployment</h2>
          <p>
            Set environment policy and create auditable, idempotent deployment
            requests.
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          onClick={() => void load()}
          disabled={Boolean(working)}
        >
          Refresh
        </button>
      </div>
      <div className="admin-feedback" aria-live="polite">
        {error && <p className="error-copy">{error}</p>}
        {notice && <p className="success-copy">{notice}</p>}
      </div>

      {environments.length ? (
        <div className="deployment-policy-list">
          {environments.map((environment) => {
            const policy = policies[environment.id];
            return (
              <article className="deployment-policy-row" key={environment.id}>
                <div>
                  <strong>{environment.label || environment.name}</strong>
                  <p>
                    {environment.enabled
                      ? "Environment enabled"
                      : "Environment disabled"}
                  </p>
                </div>
                {policy ? (
                  <div className="deployment-policy-controls">
                    <label>
                      <input
                        type="checkbox"
                        checked={policy.enabled}
                        onChange={(event) =>
                          setPolicies((current) => ({
                            ...current,
                            [environment.id]: {
                              ...policy,
                              enabled: event.target.checked,
                            },
                          }))
                        }
                      />
                      Allow deployment requests
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={policy.requireApprovedRelease}
                        onChange={(event) =>
                          setPolicies((current) => ({
                            ...current,
                            [environment.id]: {
                              ...policy,
                              requireApprovedRelease: event.target.checked,
                            },
                          }))
                        }
                      />
                      Require an approved release
                    </label>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={Boolean(working)}
                      onClick={() => void savePolicy(environment)}
                    >
                      {working === `policy:${environment.id}`
                        ? "Saving…"
                        : "Save policy"}
                    </button>
                  </div>
                ) : (
                  <p className="inline-empty">
                    Policy is unavailable for this role.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="inline-empty">
          Add a project environment before requesting a deployment.
        </p>
      )}

      <div className="deployment-request-form">
        <label className="field">
          <span>Target environment</span>
          <select
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
            disabled={!environments.length}
          >
            {environments.map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.label || environment.name}
                {environment.enabled ? "" : " (disabled)"}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reason (optional)</span>
          <input
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Release window or change reference"
          />
        </label>
        <button
          className="button button-primary"
          type="button"
          disabled={Boolean(working) || !environmentId}
          onClick={() => void createRequest()}
        >
          {working === "request" ? "Recording…" : "Request deployment"}
        </button>
      </div>

      {requests.length ? (
        <div className="deployment-request-list">
          <h3>Request history</h3>
          {requests.map((request) => {
            const environment = environments.find(
              (item) => item.id === request.environmentId,
            );
            const nextStatuses = transitions[request.status] ?? [];
            return (
              <article key={request.id}>
                <div>
                  <strong>
                    {environment?.label || environment?.name || "Environment"}
                  </strong>
                  <span
                    className={`status-pill status-${request.status.toLowerCase()}`}
                  >
                    {request.status}
                  </span>
                  <p>{request.reason || "No reason provided"}</p>
                  {request.resultSummary && (
                    <small>{request.resultSummary}</small>
                  )}
                  <time dateTime={request.requestedAt}>
                    {new Date(request.requestedAt).toLocaleString()}
                  </time>
                </div>
                {nextStatuses.length ? (
                  <label className="field">
                    <span className="visually-hidden">
                      Update request status
                    </span>
                    <select
                      aria-label={`Update deployment request ${request.id} status`}
                      disabled={Boolean(working)}
                      value=""
                      onChange={(event) => {
                        if (event.target.value)
                          void updateRequest(request.id, event.target.value);
                      }}
                    >
                      <option value="">Update status</option>
                      {nextStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

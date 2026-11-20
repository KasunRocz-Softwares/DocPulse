import React, { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "./api";
import { ApiError } from "./api-client";
import {
  ManagedSubscription,
  ProjectSubscriptionsPanelView,
  SubscriptionRelease,
  SubscriptionScope,
} from "./project-subscriptions-view";

export function ProjectSubscriptionsPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [scope, setScope] = useState<SubscriptionScope>("project");
  const [releases, setReleases] = useState<SubscriptionRelease[]>([]);
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const [subscriptions, setSubscriptions] = useState<ManagedSubscription[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(true);
  const [releaseError, setReleaseError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState("");
  const subscriptionRequestId = useRef(0);
  const releaseRequestId = useRef(0);

  const loadReleases = useCallback(async () => {
    const requestId = ++releaseRequestId.current;
    setLoadingReleases(true);
    setReleaseError("");
    try {
      const result =
        await adminApi.listProjectReleases<SubscriptionRelease[]>(projectId);
      if (requestId === releaseRequestId.current) setReleases(result);
    } catch (requestError) {
      if (requestId === releaseRequestId.current) {
        setReleases([]);
        setReleaseError(errorMessage(requestError));
      }
    } finally {
      if (requestId === releaseRequestId.current) setLoadingReleases(false);
    }
  }, [projectId]);

  const loadSubscriptions = useCallback(async () => {
    const requestId = ++subscriptionRequestId.current;
    if (scope === "release" && !selectedReleaseId) {
      setSubscriptions([]);
      setError("");
      setLoadingSubscriptions(false);
      return;
    }

    setLoadingSubscriptions(true);
    setError("");
    try {
      const result =
        scope === "project"
          ? await adminApi.listSubscriptions<ManagedSubscription[]>(projectId)
          : await adminApi.listReleaseSubscriptions<ManagedSubscription[]>(
              projectId,
              selectedReleaseId,
            );
      if (requestId === subscriptionRequestId.current) {
        setSubscriptions(result);
      }
    } catch (requestError) {
      if (requestId === subscriptionRequestId.current) {
        setSubscriptions([]);
        setError(errorMessage(requestError));
      }
    } finally {
      if (requestId === subscriptionRequestId.current) {
        setLoadingSubscriptions(false);
      }
    }
  }, [projectId, scope, selectedReleaseId]);

  useEffect(() => {
    void loadSubscriptions();
  }, [loadSubscriptions]);

  useEffect(() => {
    if (scope === "release") void loadReleases();
  }, [loadReleases, scope]);

  function changeScope(nextScope: SubscriptionScope) {
    if (nextScope === scope) return;
    subscriptionRequestId.current += 1;
    setScope(nextScope);
    setSelectedReleaseId("");
    setSubscriptions([]);
    setError("");
    setNotice("");
  }

  async function refresh() {
    if (scope === "release") await loadReleases();
    await loadSubscriptions();
  }

  async function updatePreferences(
    subscription: ManagedSubscription,
    patch: Partial<ManagedSubscription["preferences"]>,
  ) {
    setSavingId(subscription.id);
    setError("");
    setNotice("");
    try {
      const updated =
        scope === "project"
          ? await adminApi.updateSubscriptionPreferences<
              Pick<ManagedSubscription, "id" | "email" | "preferences">
            >(projectId, subscription.id, patch)
          : await adminApi.updateReleaseSubscriptionPreferences<
              Pick<ManagedSubscription, "id" | "email" | "preferences">
            >(projectId, selectedReleaseId, subscription.id, patch);
      setSubscriptions((items) =>
        items.map((item) =>
          item.id === updated.id
            ? { ...item, preferences: updated.preferences }
            : item,
        ),
      );
      setNotice(`Preferences saved for ${subscription.email}.`);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSavingId("");
    }
  }

  return (
    <ProjectSubscriptionsPanelView
      scope={scope}
      releases={releases}
      selectedReleaseId={selectedReleaseId}
      subscriptions={subscriptions}
      loadingReleases={loadingReleases}
      loadingSubscriptions={loadingSubscriptions}
      releaseError={releaseError}
      error={error}
      notice={notice}
      savingId={savingId}
      onScopeChange={changeScope}
      onReleaseChange={(releaseId) => {
        subscriptionRequestId.current += 1;
        setSelectedReleaseId(releaseId);
        setSubscriptions([]);
        setNotice("");
      }}
      onRefresh={() => void refresh()}
      onPreferenceChange={(subscription, patch) =>
        void updatePreferences(subscription, patch)
      }
    />
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "Your session has expired. Sign in again to continue.";
    if (error.status === 403)
      return "You do not have permission to view these subscribers.";
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

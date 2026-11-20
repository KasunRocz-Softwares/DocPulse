import React from "react";

export type ManagedSubscription = {
  id: string;
  email: string;
  locale: string;
  preferences: { newReleases?: boolean; securityOnly?: boolean };
  verifiedAt?: string | null;
  unsubscribedAt?: string | null;
  createdAt: string;
  _count?: { deliveries?: number };
};

export type SubscriptionRelease = {
  id: string;
  version: string;
  title: string;
};

export type SubscriptionScope = "project" | "release";

export type ProjectSubscriptionsPanelViewProps = {
  scope: SubscriptionScope;
  releases: SubscriptionRelease[];
  selectedReleaseId: string;
  subscriptions: ManagedSubscription[];
  loadingReleases: boolean;
  loadingSubscriptions: boolean;
  releaseError: string;
  error: string;
  notice: string;
  savingId: string;
  onScopeChange(scope: SubscriptionScope): void;
  onReleaseChange(releaseId: string): void;
  onRefresh(): void;
  onPreferenceChange(
    subscription: ManagedSubscription,
    patch: Partial<ManagedSubscription["preferences"]>,
  ): void;
};

const h = React.createElement;

export function ProjectSubscriptionsPanelView({
  scope,
  releases,
  selectedReleaseId,
  subscriptions,
  loadingReleases,
  loadingSubscriptions,
  releaseError,
  error,
  notice,
  savingId,
  onScopeChange,
  onReleaseChange,
  onRefresh,
  onPreferenceChange,
}: ProjectSubscriptionsPanelViewProps) {
  const activeCount = subscriptions.filter(
    (subscription) => !subscription.unsubscribedAt,
  ).length;
  const verifiedCount = subscriptions.filter((subscription) =>
    Boolean(subscription.verifiedAt),
  ).length;
  const deliveryCount = subscriptions.reduce(
    (total, subscription) => total + (subscription._count?.deliveries ?? 0),
    0,
  );
  const refreshingDisabled = loadingSubscriptions || loadingReleases;
  let subscriberContent: React.ReactNode;
  if (scope === "release" && !selectedReleaseId) {
    subscriberContent =
      releases.length > 0
        ? h(
            "p",
            { className: "empty-copy" },
            "Select a release to view its subscribers.",
          )
        : null;
  } else if (loadingSubscriptions) {
    subscriberContent = h(
      "p",
      { className: "workflow-note", role: "status" },
      `Loading ${scope === "project" ? "project" : "release"} subscribers…`,
    );
  } else if (subscriptions.length) {
    subscriberContent = h(
      "div",
      { className: "subscription-list" },
      ...subscriptions.map((subscription) =>
        h(
          "article",
          { className: "subscription-row", key: subscription.id },
          h(
            "div",
            { className: "subscription-identity" },
            h("strong", null, subscription.email),
            h(
              "small",
              null,
              subscription.verifiedAt ? "Verified" : "Awaiting verification",
              " · ",
              subscription.unsubscribedAt ? "Unsubscribed" : "Active",
              ` · ${subscription._count?.deliveries ?? 0} deliveries`,
            ),
          ),
          preferenceControl(
            "New releases",
            subscription.preferences.newReleases !== false,
            Boolean(savingId) || Boolean(subscription.unsubscribedAt),
            (checked) =>
              onPreferenceChange(subscription, { newReleases: checked }),
          ),
          preferenceControl(
            "Security only",
            subscription.preferences.securityOnly === true,
            Boolean(savingId) || Boolean(subscription.unsubscribedAt),
            (checked) =>
              onPreferenceChange(subscription, { securityOnly: checked }),
          ),
          savingId === subscription.id
            ? h("span", { className: "workflow-note" }, "Saving…")
            : null,
        ),
      ),
    );
  } else {
    subscriberContent = h(
      "div",
      { className: "empty-state" },
      h("h3", null, "No subscribers yet"),
      h(
        "p",
        null,
        scope === "project"
          ? "Customers can subscribe from the public project release page."
          : "Customers can subscribe from this release’s public page.",
      ),
    );
  }

  return h(
    "section",
    { className: "section-block", "aria-labelledby": "subscription-heading" },
    h(
      "div",
      { className: "section-heading" },
      h(
        "div",
        null,
        h("h2", { id: "subscription-heading" }, "Release subscribers"),
        h(
          "p",
          null,
          scope === "project"
            ? "Project-wide email preferences and delivery status."
            : "Email preferences and delivery status for one release.",
        ),
      ),
      h(
        "button",
        {
          className: "button button-secondary",
          type: "button",
          onClick: onRefresh,
          disabled: refreshingDisabled,
        },
        "Refresh",
      ),
    ),
    h(
      "fieldset",
      { className: "subscription-scope", "aria-label": "Subscriber scope" },
      h(
        "label",
        null,
        h("input", {
          type: "radio",
          name: "subscription-scope",
          value: "project",
          checked: scope === "project",
          onChange: () => onScopeChange("project"),
        }),
        " Project-wide",
      ),
      h(
        "label",
        null,
        h("input", {
          type: "radio",
          name: "subscription-scope",
          value: "release",
          checked: scope === "release",
          onChange: () => onScopeChange("release"),
        }),
        " Release-specific",
      ),
    ),
    scope === "release"
      ? h(
          "div",
          { className: "subscription-release-select" },
          loadingReleases
            ? h(
                "p",
                { className: "workflow-note", role: "status" },
                "Loading project releases…",
              )
            : null,
          releaseError
            ? h("p", { className: "error-copy", role: "alert" }, releaseError)
            : null,
          !loadingReleases && !releaseError && releases.length === 0
            ? h(
                "p",
                { className: "empty-copy" },
                "No releases available for this project.",
              )
            : null,
          releases.length > 0
            ? h(
                "label",
                null,
                h("span", null, "Release"),
                h(
                  "select",
                  {
                    value: selectedReleaseId,
                    onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
                      onReleaseChange(event.target.value),
                    "aria-label": "Release",
                  },
                  h("option", { value: "" }, "Select a release"),
                  ...releases.map((release) =>
                    h(
                      "option",
                      { key: release.id, value: release.id },
                      `${release.version} · ${release.title}`,
                    ),
                  ),
                ),
              )
            : null,
        )
      : null,
    error ? h("p", { className: "error-copy", role: "alert" }, error) : null,
    notice
      ? h("p", { className: "success-copy", "aria-live": "polite" }, notice)
      : null,
    h(
      "div",
      { className: "subscription-metrics", "aria-label": "Subscriber totals" },
      metric("Subscribers", subscriptions.length),
      metric("Active subscribers", activeCount),
      metric("Verified subscribers", verifiedCount),
      metric("Total deliveries", deliveryCount),
    ),
    subscriberContent,
  );
}

function metric(label: string, value: number) {
  return h(
    "div",
    { className: "subscription-metric", key: label },
    h("span", null, label),
    h("strong", null, value),
  );
}

function preferenceControl(
  label: string,
  checked: boolean,
  disabled: boolean,
  onChange: (checked: boolean) => void,
) {
  return h(
    "label",
    null,
    h("input", {
      type: "checkbox",
      checked,
      disabled,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onChange(event.target.checked),
    }),
    ` ${label}`,
  );
}

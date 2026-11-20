/** English copy used by the designer preview (the public site has its own i18n). */
export const PUBLIC_PAGE_ENGLISH: Record<string, string> = {
  whatsNew: "What’s new",
  heroText:
    "Approved release notes, version history, and product changes—all in one public place.",
  latestPublishedRelease: "Latest published release",
  releaseNotesAvailable: "Release notes are available.",
  readReleaseNotes: "Read release notes",
  recentReleases: "Recent releases",
  viewAllReleases: "View all",
  releaseStats: "At a glance",
  statReleases: "Published releases",
  lastUpdated: "Last updated",
  aboutProject: "About",
  pageLinks: "Explore",
  browseReleaseHistory: "Browse release history",
  readChangelog: "Read the changelog",
  subscribeRss: "Subscribe with RSS",
  usefulLinks: "Links",
  searchReleases: "Search releases",
  searchUpdates: "Search updates",
  search: "Search",
  emailUpdates: "Email updates",
  getByEmail: "Get release notes by email",
  confirmBeforeSending: "Confirm your email before project updates are sent.",
  emailAddress: "Email address",
  subscribe: "Subscribe",
  sending: "Sending…",
  noReleases: "No published releases are available.",
  confirmationCheckInbox: "Check your inbox for a confirmation link.",
  subscriptionRequestFailed:
    "Could not request a subscription. Please try again.",
  poweredBy: "Powered by",
  overview: "Overview",
  releaseHistory: "Release history",
  changelog: "Changelog",
  rssFeed: "RSS feed",
  publishedInformation: "Published release information",
};

export function translatePreview(
  key: string,
  values: Record<string, string | number> = {},
) {
  let message = PUBLIC_PAGE_ENGLISH[key] ?? key;
  for (const [name, value] of Object.entries(values))
    message = message.replaceAll(`{${name}}`, String(value));
  return message;
}

export const supportedLocales = ["en", "si-LK", "ta-LK"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

/** Canonicalize release-content locales without restricting them to UI catalogs. */
export function normalizeContentLocale(value?: string | null): string {
  if (!value?.trim()) return "en";
  try {
    const [canonical] = Intl.getCanonicalLocales(
      value.trim().replaceAll("_", "-"),
    );
    return canonical && canonical.length <= 255 ? canonical : "en";
  } catch {
    return "en";
  }
}

/** Keep UI catalog choices while making every locale present in a publication selectable. */
export function contentLocaleOptions(
  publishedLocales: readonly string[] = [],
  selectedLocale?: string | null,
): string[] {
  const options = new Map<string, string>();
  for (const rawLocale of [
    ...supportedLocales,
    ...publishedLocales,
    ...(selectedLocale ? [selectedLocale] : []),
  ]) {
    const locale = normalizeContentLocale(rawLocale);
    options.set(locale.toLowerCase(), locale);
  }
  return [...options.values()];
}

const english = {
  language: "Language",
  skipToContent: "Skip to content",
  releaseNotes: "release notes",
  mainNavigation: "Main navigation",
  projectPages: "Project pages",
  project: "Project",
  history: "History",
  rssFeed: "RSS feed",
  releaseDocumentation: "RELEASE DOCUMENTATION & PUBLISHING",
  projectDirectory: "PROJECT DIRECTORY",
  projectProfile: "PROJECT PROFILE",
  publicSearch: "PUBLIC SEARCH",
  directoryTitle: "Product updates, clearly delivered.",
  releaseTitle: "Version",
  whatsNew: "What’s new",
  heroText:
    "Approved release notes, version history, and product changes—all in one public place.",
  copyShareLink: "Copy share link",
  linkCopied: "Link copied",
  pageLinkCopied: "Page link copied to clipboard.",
  overview: "Overview",
  releaseHistory: "Release history",
  changelog: "Changelog",
  rss: "RSS",
  searchReleases: "Search releases",
  searchUpdates: "Search updates",
  search: "Search",
  loading: "Loading published release data…",
  loadErrorTitle: "We couldn’t load this page",
  tryAgain: "Try again",
  allProjects: "All projects",
  publishedInformation: "Published release information",
  poweredBy: "Powered by",
  publishedProducts: "Published products",
  filterProjects: "Filter projects",
  projectName: "Project name",
  noProjects: "No public projects have published release notes yet.",
  noMatchingProjects: "No projects match that filter.",
  published: "published",
  release: "release",
  releases: "releases",
  updated: "Updated",
  viewProject: "View project",
  logoAlt: "logo",
  publishedReleases: "published releases",
  browseApproved: "Browse approved updates for",
  publicPagesInclude:
    "Public pages include release information that has been published for this project.",
  latestPublishedRelease: "LATEST PUBLISHED RELEASE",
  releaseNotesAvailable: "Release notes are available.",
  readReleaseNotes: "Read release notes",
  browseReleaseHistory: "Browse release history",
  readChangelog: "Read the changelog",
  subscribeRss: "Subscribe with RSS",
  versions: "versions",
  noReleases: "No published releases are available.",
  projectPagination: "Project directory pages",
  releasePagination: "Release history pages",
  previousPage: "Previous",
  nextPage: "Next",
  readVersionNotes: "Read {version} release notes",
  releaseNotesEyebrow: "RELEASE NOTES",
  copied: "Copied",
  copyLink: "Copy link",
  publishedOn: "Published",
  shareLinkedIn: "Share on LinkedIn",
  shareEmail: "Share by email",
  releaseCopied: "Release link copied to clipboard.",
  whatChanged: "What changed",
  releaseAttachments: "Release attachments",
  noPublicChanges: "No public changes were included in this release.",
  backToHistory: "Back to release history",
  searchResultsFor: "Search results for “{query}”",
  matching: "matching",
  noSearchResults: "No published releases matched that search.",
  unavailable: "This published page is unavailable.",
  loadFailure: "Could not load release information.",
  directoryMetaTitle: "RDPS · Public release notes",
  directoryMetaDescription:
    "Browse published product updates and release notes.",
  releaseMetaDescription: "Release notes for {project} {version}",
  projectMetaTitle: "{project} release notes",
  projectMetaDescription: "Browse {count} published releases for {project}.",
  historyMetaTitle: "Release history · {project}",
  changelogMetaTitle: "Changelog · {project}",
  publishedUpdatesMeta: "Published release updates for {project}.",
  searchMetaTitle: "Search · {project}",
  searchMetaDescription: "Search published release notes for {project}.",
  emailUpdates: "EMAIL UPDATES",
  getByEmail: "Get release notes by email",
  confirmBeforeSending: "Confirm your email before project updates are sent.",
  emailAddress: "Email address",
  sending: "Sending…",
  subscribe: "Subscribe",
  subscriptionRequestFailed:
    "Could not request a subscription. Please try again.",
  confirmationCheckInbox: "Check your inbox for a confirmation link.",
  processingRequest: "Processing your request…",
  subscriptionLinkUnavailable: "This subscription link is unavailable.",
  subscriptionConfirmed: "Your subscription is confirmed.",
  confirmationExpired:
    "This confirmation link has expired or was already used.",
  unsubscribed: "You have been unsubscribed.",
  unsubscribeExpired: "This unsubscribe link has expired or was already used.",
  requestNewLink: "Request a new link from the project page.",
  emailPreferences: "EMAIL PREFERENCES",
  confirmSubscription: "Confirm subscription",
  unsubscribe: "Unsubscribe",
} satisfies Record<string, string>;

const sinhala: Record<keyof typeof english, string> = {
  language: "භාෂාව",
  skipToContent: "අන්තර්ගතයට යන්න",
  releaseNotes: "නිකුතු සටහන්",
  mainNavigation: "ප්‍රධාන සංචාලනය",
  projectPages: "ව්‍යාපෘති පිටු",
  project: "ව්‍යාපෘතිය",
  history: "ඉතිහාසය",
  rssFeed: "RSS සංග්‍රහය",
  releaseDocumentation: "නිකුතු ලේඛන සහ ප්‍රකාශනය",
  projectDirectory: "ව්‍යාපෘති නාමාවලිය",
  projectProfile: "ව්‍යාපෘති පැතිකඩ",
  publicSearch: "පොදු සෙවීම",
  directoryTitle: "නිෂ්පාදන යාවත්කාලීන පැහැදිලිව ඉදිරිපත් කරයි.",
  releaseTitle: "අනුවාදය",
  whatsNew: "අලුත් දේ",
  heroText:
    "අනුමත නිකුතු සටහන්, අනුවාද ඉතිහාසය සහ නිෂ්පාදන වෙනස්කම්—එක් පොදු ස්ථානයක.",
  copyShareLink: "බෙදාගැනීමේ සබැඳිය පිටපත් කරන්න",
  linkCopied: "සබැඳිය පිටපත් කළා",
  pageLinkCopied: "පිටුවේ සබැඳිය පසුරු පුවරුවට පිටපත් කළා.",
  overview: "දළ විශ්ලේෂණය",
  releaseHistory: "නිකුතු ඉතිහාසය",
  changelog: "වෙනස්කම් ලැයිස්තුව",
  rss: "RSS",
  searchReleases: "නිකුතු සොයන්න",
  searchUpdates: "යාවත්කාලීන සොයන්න",
  search: "සොයන්න",
  loading: "ප්‍රකාශිත නිකුතු දත්ත පූරණය කරමින්…",
  loadErrorTitle: "මෙම පිටුව පූරණය කළ නොහැකි විය",
  tryAgain: "නැවත උත්සාහ කරන්න",
  allProjects: "සියලු ව්‍යාපෘති",
  publishedInformation: "ප්‍රකාශිත නිකුතු තොරතුරු",
  poweredBy: "බලගන්වන්නේ",
  publishedProducts: "ප්‍රකාශිත නිෂ්පාදන",
  filterProjects: "ව්‍යාපෘති පෙරහන් කරන්න",
  projectName: "ව්‍යාපෘතියේ නම",
  noProjects: "තවමත් පොදු ව්‍යාපෘති කිසිවක් නිකුතු සටහන් ප්‍රකාශ කර නැත.",
  noMatchingProjects: "එම පෙරහනට ගැළපෙන ව්‍යාපෘති නැත.",
  published: "ප්‍රකාශිත",
  release: "නිකුතුව",
  releases: "නිකුතු",
  updated: "යාවත්කාලීන කළේ",
  viewProject: "ව්‍යාපෘතිය බලන්න",
  logoAlt: "ලාංඡනය",
  publishedReleases: "ප්‍රකාශිත නිකුතු",
  browseApproved: "අනුමත යාවත්කාලීන බලන්න",
  publicPagesInclude:
    "මෙම ව්‍යාපෘතිය සඳහා ප්‍රකාශිත නිකුතු තොරතුරු පොදු පිටුවල ඇතුළත් වේ.",
  latestPublishedRelease: "නවතම ප්‍රකාශිත නිකුතුව",
  releaseNotesAvailable: "නිකුතු සටහන් තිබේ.",
  readReleaseNotes: "නිකුතු සටහන් කියවන්න",
  browseReleaseHistory: "නිකුතු ඉතිහාසය බලන්න",
  readChangelog: "වෙනස්කම් ලැයිස්තුව කියවන්න",
  subscribeRss: "RSS සමඟ දායක වන්න",
  versions: "අනුවාද",
  noReleases: "ප්‍රකාශිත නිකුතු නොමැත.",
  projectPagination: "ව්‍යාපෘති නාමාවලි පිටු",
  releasePagination: "නිකුතු ඉතිහාස පිටු",
  previousPage: "පෙර",
  nextPage: "ඊළඟ",
  readVersionNotes: "{version} නිකුතු සටහන් කියවන්න",
  releaseNotesEyebrow: "නිකුතු සටහන්",
  copied: "පිටපත් කළා",
  copyLink: "සබැඳිය පිටපත් කරන්න",
  publishedOn: "ප්‍රකාශිත දිනය",
  shareLinkedIn: "LinkedIn හි බෙදාගන්න",
  shareEmail: "ඊමේල් මඟින් බෙදාගන්න",
  releaseCopied: "නිකුතු සබැඳිය පසුරු පුවරුවට පිටපත් කළා.",
  whatChanged: "වෙනස් වූ දේ",
  releaseAttachments: "නිකුතු අමුණා ඇති ගොනු",
  noPublicChanges: "මෙම නිකුතුවට පොදු වෙනස්කම් ඇතුළත් කර නැත.",
  backToHistory: "නිකුතු ඉතිහාසයට ආපසු යන්න",
  searchResultsFor: "“{query}” සඳහා සෙවුම් ප්‍රතිඵල",
  matching: "ගැළපෙන",
  noSearchResults: "එම සෙවුමට ගැළපෙන ප්‍රකාශිත නිකුතු නැත.",
  unavailable: "මෙම ප්‍රකාශිත පිටුව ලබාගත නොහැක.",
  loadFailure: "නිකුතු තොරතුරු පූරණය කළ නොහැක.",
  directoryMetaTitle: "RDPS · පොදු නිකුතු සටහන්",
  directoryMetaDescription:
    "ප්‍රකාශිත නිෂ්පාදන යාවත්කාලීන සහ නිකුතු සටහන් බලන්න.",
  releaseMetaDescription: "{project} {version} සඳහා නිකුතු සටහන්",
  projectMetaTitle: "{project} නිකුතු සටහන්",
  projectMetaDescription: "{project} සඳහා ප්‍රකාශිත නිකුතු {count} බලන්න.",
  historyMetaTitle: "නිකුතු ඉතිහාසය · {project}",
  changelogMetaTitle: "වෙනස්කම් ලැයිස්තුව · {project}",
  publishedUpdatesMeta: "{project} සඳහා ප්‍රකාශිත නිකුතු යාවත්කාලීන.",
  searchMetaTitle: "සෙවීම · {project}",
  searchMetaDescription: "{project} සඳහා ප්‍රකාශිත නිකුතු සටහන් සොයන්න.",
  emailUpdates: "ඊමේල් යාවත්කාලීන",
  getByEmail: "නිකුතු සටහන් ඊමේල් මඟින් ලබාගන්න",
  confirmBeforeSending:
    "ව්‍යාපෘති යාවත්කාලීන යැවීමට පෙර ඔබේ ඊමේල් ලිපිනය තහවුරු කරන්න.",
  emailAddress: "ඊමේල් ලිපිනය",
  sending: "යවමින්…",
  subscribe: "දායක වන්න",
  subscriptionRequestFailed: "දායකත්ව ඉල්ලීම යැවිය නොහැක. නැවත උත්සාහ කරන්න.",
  confirmationCheckInbox:
    "තහවුරු කිරීමේ සබැඳියක් සඳහා ඔබේ එන ලිපි පරීක්ෂා කරන්න.",
  processingRequest: "ඔබගේ ඉල්ලීම සැකසෙමින්…",
  subscriptionLinkUnavailable: "මෙම දායකත්ව සබැඳිය ලබාගත නොහැක.",
  subscriptionConfirmed: "ඔබගේ දායකත්වය තහවුරු කර ඇත.",
  confirmationExpired:
    "මෙම තහවුරු කිරීමේ සබැඳිය කල් ඉකුත් වී හෝ දැනටමත් භාවිතා කර ඇත.",
  unsubscribed: "ඔබ දායකත්වයෙන් ඉවත් වී ඇත.",
  unsubscribeExpired:
    "මෙම ඉවත් වීමේ සබැඳිය කල් ඉකුත් වී හෝ දැනටමත් භාවිතා කර ඇත.",
  requestNewLink: "ව්‍යාපෘති පිටුවෙන් නව සබැඳියක් ඉල්ලන්න.",
  emailPreferences: "ඊමේල් මනාප",
  confirmSubscription: "දායකත්වය තහවුරු කරන්න",
  unsubscribe: "දායකත්වයෙන් ඉවත් වන්න",
};

const tamil: Record<keyof typeof english, string> = {
  language: "மொழி",
  skipToContent: "உள்ளடக்கத்திற்குச் செல்க",
  releaseNotes: "வெளியீட்டுக் குறிப்புகள்",
  mainNavigation: "முதன்மை வழிசெலுத்தல்",
  projectPages: "திட்டப் பக்கங்கள்",
  project: "திட்டம்",
  history: "வரலாறு",
  rssFeed: "RSS ஊட்டம்",
  releaseDocumentation: "வெளியீட்டு ஆவணங்கள் மற்றும் வெளியீடு",
  projectDirectory: "திட்டப் பட்டியல்",
  projectProfile: "திட்ட விவரம்",
  publicSearch: "பொதுத் தேடல்",
  directoryTitle: "தயாரிப்பு புதுப்பிப்புகள் தெளிவாக வழங்கப்படுகின்றன.",
  releaseTitle: "பதிப்பு",
  whatsNew: "புதியது என்ன",
  heroText:
    "அங்கீகரிக்கப்பட்ட வெளியீட்டுக் குறிப்புகள், பதிப்பு வரலாறு மற்றும் தயாரிப்பு மாற்றங்கள்—ஒரே பொது இடத்தில்.",
  copyShareLink: "பகிர்வு இணைப்பை நகலெடு",
  linkCopied: "இணைப்பு நகலெடுக்கப்பட்டது",
  pageLinkCopied: "பக்க இணைப்பு கிளிப்போர்டுக்கு நகலெடுக்கப்பட்டது.",
  overview: "கண்ணோட்டம்",
  releaseHistory: "வெளியீட்டு வரலாறு",
  changelog: "மாற்றப் பதிவு",
  rss: "RSS",
  searchReleases: "வெளியீடுகளைத் தேடு",
  searchUpdates: "புதுப்பிப்புகளைத் தேடு",
  search: "தேடு",
  loading: "வெளியிடப்பட்ட வெளியீட்டுத் தரவு ஏற்றப்படுகிறது…",
  loadErrorTitle: "இந்தப் பக்கத்தை ஏற்ற முடியவில்லை",
  tryAgain: "மீண்டும் முயற்சி செய்",
  allProjects: "அனைத்து திட்டங்களும்",
  publishedInformation: "வெளியிடப்பட்ட வெளியீட்டுத் தகவல்",
  poweredBy: "இயங்குவது",
  publishedProducts: "வெளியிடப்பட்ட தயாரிப்புகள்",
  filterProjects: "திட்டங்களை வடிகட்டு",
  projectName: "திட்டத்தின் பெயர்",
  noProjects:
    "இதுவரை எந்தப் பொது திட்டமும் வெளியீட்டுக் குறிப்புகளை வெளியிடவில்லை.",
  noMatchingProjects: "இந்த வடிகட்டிக்கு எந்தத் திட்டமும் பொருந்தவில்லை.",
  published: "வெளியிடப்பட்ட",
  release: "வெளியீடு",
  releases: "வெளியீடுகள்",
  updated: "புதுப்பிக்கப்பட்டது",
  viewProject: "திட்டத்தைப் பார்",
  logoAlt: "லோகோ",
  publishedReleases: "வெளியிடப்பட்ட வெளியீடுகள்",
  browseApproved: "அங்கீகரிக்கப்பட்ட புதுப்பிப்புகளைப் பார்",
  publicPagesInclude:
    "இந்தத் திட்டத்திற்காக வெளியிடப்பட்ட வெளியீட்டுத் தகவல்கள் பொது பக்கங்களில் உள்ளன.",
  latestPublishedRelease: "சமீபத்திய வெளியீடு",
  releaseNotesAvailable: "வெளியீட்டுக் குறிப்புகள் உள்ளன.",
  readReleaseNotes: "வெளியீட்டுக் குறிப்புகளைப் படி",
  browseReleaseHistory: "வெளியீட்டு வரலாற்றைப் பார்",
  readChangelog: "மாற்றப் பதிவைப் படி",
  subscribeRss: "RSS மூலம் பின்தொடர்",
  versions: "பதிப்புகள்",
  noReleases: "வெளியிடப்பட்ட வெளியீடுகள் எதுவும் இல்லை.",
  projectPagination: "திட்டப் பட்டியல் பக்கங்கள்",
  releasePagination: "வெளியீட்டு வரலாற்றுப் பக்கங்கள்",
  previousPage: "முந்தையது",
  nextPage: "அடுத்து",
  readVersionNotes: "{version} வெளியீட்டுக் குறிப்புகளைப் படி",
  releaseNotesEyebrow: "வெளியீட்டுக் குறிப்புகள்",
  copied: "நகலெடுக்கப்பட்டது",
  copyLink: "இணைப்பை நகலெடு",
  publishedOn: "வெளியிடப்பட்டது",
  shareLinkedIn: "LinkedIn-இல் பகிர்",
  shareEmail: "மின்னஞ்சல் மூலம் பகிர்",
  releaseCopied: "வெளியீட்டு இணைப்பு கிளிப்போர்டுக்கு நகலெடுக்கப்பட்டது.",
  whatChanged: "என்ன மாறியது",
  releaseAttachments: "வெளியீட்டு இணைப்புகள்",
  noPublicChanges:
    "இந்த வெளியீட்டில் பொதுவான மாற்றங்கள் எதுவும் சேர்க்கப்படவில்லை.",
  backToHistory: "வெளியீட்டு வரலாற்றிற்குத் திரும்பு",
  searchResultsFor: "“{query}” என்பதற்கான தேடல் முடிவுகள்",
  matching: "பொருந்தும்",
  noSearchResults: "இந்தத் தேடலுக்குப் பொருந்தும் வெளியீடுகள் இல்லை.",
  unavailable: "இந்த வெளியிடப்பட்ட பக்கத்தை அணுக முடியவில்லை.",
  loadFailure: "வெளியீட்டுத் தகவலை ஏற்ற முடியவில்லை.",
  directoryMetaTitle: "RDPS · பொது வெளியீட்டுக் குறிப்புகள்",
  directoryMetaDescription:
    "வெளியிடப்பட்ட தயாரிப்பு புதுப்பிப்புகளையும் குறிப்புகளையும் பார்.",
  releaseMetaDescription: "{project} {version} வெளியீட்டுக் குறிப்புகள்",
  projectMetaTitle: "{project} வெளியீட்டுக் குறிப்புகள்",
  projectMetaDescription:
    "{project}-இன் வெளியிடப்பட்ட {count} வெளியீடுகளைப் பார்.",
  historyMetaTitle: "வெளியீட்டு வரலாறு · {project}",
  changelogMetaTitle: "மாற்றப் பதிவு · {project}",
  publishedUpdatesMeta: "{project}-க்கான வெளியிடப்பட்ட புதுப்பிப்புகள்.",
  searchMetaTitle: "தேடல் · {project}",
  searchMetaDescription: "{project}-இன் வெளியிடப்பட்ட குறிப்புகளைத் தேடு.",
  emailUpdates: "மின்னஞ்சல் புதுப்பிப்புகள்",
  getByEmail: "வெளியீட்டுக் குறிப்புகளை மின்னஞ்சலில் பெறுங்கள்",
  confirmBeforeSending:
    "திட்டப் புதுப்பிப்புகள் அனுப்பப்படுவதற்கு முன் உங்கள் மின்னஞ்சலை உறுதிப்படுத்துங்கள்.",
  emailAddress: "மின்னஞ்சல் முகவரி",
  sending: "அனுப்பப்படுகிறது…",
  subscribe: "பின்தொடர்",
  subscriptionRequestFailed:
    "பின்தொடர கோர முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
  confirmationCheckInbox:
    "உறுதிப்படுத்தல் இணைப்புக்கு உங்கள் இன்பாக்ஸைப் பாருங்கள்.",
  processingRequest: "உங்கள் கோரிக்கை செயலாக்கப்படுகிறது…",
  subscriptionLinkUnavailable: "இந்தப் பின்தொடர்தல் இணைப்பை அணுக முடியவில்லை.",
  subscriptionConfirmed: "உங்கள் பின்தொடர்தல் உறுதிப்படுத்தப்பட்டது.",
  confirmationExpired:
    "இந்த உறுதிப்படுத்தல் இணைப்பு காலாவதியாகிவிட்டது அல்லது ஏற்கனவே பயன்படுத்தப்பட்டது.",
  unsubscribed: "நீங்கள் பின்தொடர்விலிருந்து விலகிவிட்டீர்கள்.",
  unsubscribeExpired:
    "இந்த விலகல் இணைப்பு காலாவதியாகிவிட்டது அல்லது ஏற்கனவே பயன்படுத்தப்பட்டது.",
  requestNewLink: "திட்டப் பக்கத்திலிருந்து புதிய இணைப்பைக் கோருங்கள்.",
  emailPreferences: "மின்னஞ்சல் விருப்பங்கள்",
  confirmSubscription: "பின்தொடர்வை உறுதிப்படுத்து",
  unsubscribe: "பின்தொடர்விலிருந்து விலகு",
};

/** Phrases for the configurable public page (widgets, dates, not-found page). */
const englishWidgetStrings = {
  recentReleases: "Recent releases",
  viewAllReleases: "View all",
  releaseStats: "At a glance",
  statReleases: "Published releases",
  releasedOn: "Released",
  pageNotFoundTitle: "Page not found · RDPS",
  pageNotFoundHeading: "This page isn’t available",
  pageNotFoundBody:
    "Release notes are published on each product’s own page. Check the link you were given.",
  lastUpdated: "Last updated",
  aboutProject: "About",
  pageLinks: "Explore",
  usefulLinks: "Links",
};

const sinhalaWidgetStrings: Record<keyof typeof englishWidgetStrings, string> =
  {
    recentReleases: "මෑත නිකුතු",
    viewAllReleases: "සියල්ල බලන්න",
    releaseStats: "සාරාංශය",
    statReleases: "ප්‍රකාශිත නිකුතු",
    releasedOn: "නිකුත් කළේ",
    pageNotFoundTitle: "පිටුව හමු නොවීය · RDPS",
    pageNotFoundHeading: "මෙම පිටුව ලබා ගත නොහැක",
    pageNotFoundBody:
      "නිකුතු සටහන් එක් එක් නිෂ්පාදනයේම පිටුවේ ප්‍රකාශ කෙරේ. ඔබට ලැබුණු සබැඳිය පරීක්ෂා කරන්න.",
    lastUpdated: "අවසන් වරට යාවත්කාලීන කළේ",
    aboutProject: "පිළිබඳව",
    pageLinks: "ගවේෂණය කරන්න",
    usefulLinks: "සබැඳි",
  };

const tamilWidgetStrings: Record<keyof typeof englishWidgetStrings, string> = {
  recentReleases: "சமீபத்திய வெளியீடுகள்",
  viewAllReleases: "அனைத்தையும் காண்க",
  releaseStats: "ஒரு பார்வையில்",
  statReleases: "வெளியிடப்பட்ட வெளியீடுகள்",
  releasedOn: "வெளியிடப்பட்டது",
  pageNotFoundTitle: "பக்கம் கிடைக்கவில்லை · RDPS",
  pageNotFoundHeading: "இந்தப் பக்கம் கிடைக்கவில்லை",
  pageNotFoundBody:
    "வெளியீட்டுக் குறிப்புகள் ஒவ்வொரு தயாரிப்பின் சொந்தப் பக்கத்திலும் வெளியிடப்படுகின்றன. உங்களுக்கு வழங்கப்பட்ட இணைப்பைச் சரிபார்க்கவும்.",
  lastUpdated: "கடைசியாகப் புதுப்பிக்கப்பட்டது",
  aboutProject: "பற்றி",
  pageLinks: "ஆராயுங்கள்",
  usefulLinks: "இணைப்புகள்",
};

const catalogs: Record<SupportedLocale, Record<string, string>> = {
  en: { ...english, ...englishWidgetStrings },
  "si-LK": { ...sinhala, ...sinhalaWidgetStrings },
  "ta-LK": { ...tamil, ...tamilWidgetStrings },
};

export function normalizeLocale(value?: string | null): SupportedLocale {
  if (!value?.trim()) return "en";
  const input = value.trim().replaceAll("_", "-");
  try {
    const [canonical] = Intl.getCanonicalLocales(input);
    const language = canonical?.split("-")[0]?.toLowerCase();
    if (language === "si") return "si-LK";
    if (language === "ta") return "ta-LK";
    if (language === "en") return "en";
  } catch {
    return "en";
  }
  return "en";
}

export function getLocaleCatalog(locale?: string | null) {
  return catalogs[normalizeLocale(locale)];
}

export function translate(
  locale: string | null | undefined,
  key: string,
  values: Record<string, string | number> = {},
) {
  let message =
    catalogs[normalizeLocale(locale)][key] ?? catalogs.en[key] ?? key;
  for (const [name, value] of Object.entries(values))
    message = message.replaceAll(`{${name}}`, String(value));
  return message;
}

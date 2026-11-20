# Security vulnerability disclosure policy

**Status:** Repository policy; operational contact route must be configured by the repository owner before public launch.  
**Last reviewed:** 2026-11-11

## Reporting a vulnerability

Please report suspected RDPS vulnerabilities privately to the repository or service owner through an access-controlled security contact channel. If the hosting platform provides a private vulnerability-reporting feature, use it. Do not open a public issue or include exploitable details in a public discussion.

The repository owner must publish and monitor a dedicated security contact route before accepting reports from external users. This repository does not currently declare a public email address or promise a response-time SLA; do not infer one from this document.

Include, where safe:

- affected RDPS version, deployment type and component;
- concise impact and the security boundary affected;
- reproduction steps or a minimal proof of concept;
- logs or screenshots with credentials, personal data and customer content removed;
- a safe way to coordinate follow-up.

Encrypt sensitive details when the reporting channel supports encryption. Do not send live credentials, customer datasets or production secrets.

## Researcher expectations

- Make a good-faith effort to avoid privacy violations, service disruption, data destruction and access to data beyond what is needed to demonstrate the issue.
- Test only systems you own or have explicit authorization to test.
- Stop and report promptly if testing exposes another user's data or production secrets.
- Give the maintainers a reasonable opportunity to investigate and remediate before public disclosure. Coordinate a disclosure date with the maintainers; there is no automatic deadline in this policy.
- Do not use vulnerabilities to extort, threaten or demand payment.

## Maintainer handling

The service owner should acknowledge reports through the private channel, assess severity and affected releases, preserve a confidential incident record, coordinate a fix and any required customer or authority notification, and publish a security advisory when disclosure is safe. Release notes must not expose exploit details or affected customer information before coordinated disclosure.

Access to reports and reproduction data must be limited to responders who need it. Store secrets only in the approved secret manager and remove unnecessary sensitive material from tickets, logs and test fixtures.

## Scope

This policy covers RDPS source, supported deployment artifacts and RDPS-operated services explicitly controlled by the reporting party's authorization. Third-party services, dependencies and infrastructure are governed by their owners' policies. Availability testing, social engineering, physical attacks and testing against another tenant without written authorization are out of scope.

## Status of this policy

This file documents a process, not a staffed security response program. Before public launch, the repository owner must add the actual monitored reporting URL/contact and confirm who receives and triages reports. No bounty, service-level agreement, or legal safe-harbor promise is made here.

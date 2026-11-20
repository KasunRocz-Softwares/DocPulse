# RDPS release checklist

## Before release

- [ ] The release commit is identified and the matching CI run passes install,
      formatting, typecheck, tests, build, and all production image builds.
- [ ] Publish the API, worker, migration, web, and Alertmanager images from the
      approved tag through the GHCR release workflow; verify the artifact's
      immutable digest manifest and source commit.
- [ ] Select the reviewed ClamAV sha256 digest and load it as `CLAMAV_IMAGE`.
- [ ] Container/image vulnerability and license reviews meet organizational
      policy. Registry publication is automated; production deployment remains
      an explicit protected-environment operator action.
- [ ] Runtime secret references exist for the intended environment; no secret
      value is copied into source, build arguments, logs, or release notes.
- [ ] PostgreSQL and Redis connectivity, TLS policy, storage capacity, and
      alerting are confirmed.
- [ ] Recent PostgreSQL and attachment-volume backups are checksum/archive
      verified, and the latest isolated database and attachment restore drill
      has a recorded result.
- [ ] Rollback image digests, database recovery approach, and release owner are
      recorded.

## Release execution

- [ ] Run the migration image once against the target database and retain the
      job output/exit status without exposing the connection URI.
- [ ] Roll out API and worker on the private network, then the Nginx web image
      behind approved TLS ingress.
- [ ] Check Nginx `/healthz`, API `/api/v1/health/ready`, public routes, admin login,
      worker queue processing, database connections, and error/latency alerts.
- [ ] Confirm the API, worker, and web image digests match the approved release.
- [ ] Confirm no failed migration, elevated error rate, secret exposure, or
      public/internal data boundary regression.

## Closeout

- [ ] Record commit, image digests, migration result, backup identifier,
      smoke-check evidence, operator, start/end time, and rollback decision.
- [ ] If any release gate fails, stop rollout and follow the documented
      rollback/recovery plan; preserve relevant logs with secrets redacted.

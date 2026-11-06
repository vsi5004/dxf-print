# SiteGround deployment

Target: `https://ivansbuilds.com/tools/dxf-print/`.

## Separate repositories

This repository owns source, tests, CI, build artifacts, and deployment. The portfolio keeps only a link and a deploy exclusion; it does not import or build the tool. Deploying one project must not delete the other.

In the portfolio's `.github/workflows/deploy.yml`, preserve the tool directory with:

```yaml
EXCLUDE: '.git/, .github/, tools/dxf-print/'
```

The existing portfolio rsync uses `--delete`, so this exclusion is required **before** enabling the tool's production deployment. Do not add `--delete-excluded` to either project.

## Repository setup

Create a `production` GitHub environment and provision these secrets there or at repository scope:

| Secret                   | Value                                                                   |
| ------------------------ | ----------------------------------------------------------------------- |
| `SITEGROUND_DEPLOY_KEY`  | Private key already authorized by SiteGround for the deployment account |
| `SITEGROUND_HOST`        | Existing SiteGround SSH hostname                                        |
| `SITEGROUND_USER`        | Existing SiteGround SSH username                                        |
| `SITEGROUND_KNOWN_HOSTS` | Verified known_hosts entry for `[hostname]:18765`                       |

Verify the SSH fingerprint through a trusted source before provisioning the known_hosts entry. Do not rely on an unverified key scan during CI. Never commit credentials. GitHub does not expose the values of secrets from the portfolio repository, so they must be separately provisioned or configured as appropriate organization secrets.

Set repository variable `SITEGROUND_DEPLOY_ENABLED` to `true` **after** the portfolio exclusion and secrets are configured. Until then, CI still runs and uploads the production artifact, while deployment is intentionally skipped.

`CI` runs formatting, lint, unit/PDF tests, a production build, and desktop/mobile browser tests on pull requests and main pushes. It uploads `dxf-print-dist` only after all checks pass. The separate deployment workflow consumes that artifact only from successful main-branch **push** runs, never from pull-request code, and rsyncs only the fixed tool directory. Production credentials are unavailable to build/test steps.

The included `.htaccess` applies a restrictive CSP and basic response headers where Apache supports them. Static hosting elsewhere can serve the same `dist/` and configure equivalent headers.

## First deploy and rollback

After configuration, push a change to main to run CI and deploy. Confirm the live URL, file import, PDF download, and physical scale calibration. Retain previous build artifacts or tags before updating. To roll back, revert the source commit and let the same checks rebuild and deploy it.

This tool should not be considered deployed merely because its CI artifact exists or its workflow is configured; verify a successful deployment run and the live URL.

# SiteGround deployment

Target: `https://ivansbuilds.com/tools/dxf-print/`.

## Current hosting arrangement

The tool repository owns source, CI, production artifacts and automated build releases. A separate `Deploy DXF tool` workflow in the portfolio/hosting repository downloads the latest successful distribution, verifies its checksum, and syncs only the tool subdirectory using the existing SiteGround secrets. It does not build the portfolio or execute downloaded application code.

The hosting workflow checks every 15 minutes and also supports manual dispatch. GitHub can delay scheduled runs. It compares freshly requested version metadata with the release commit and exits without deploying when unchanged. Manual dispatch offers a force option for recovery. Hashed assets are retained across deployments, and recent releases are backfilled so cached pages can still load their original dynamic modules. Do not add `--delete` to the tool-hosting sync without a cache-aware asset retention policy.

This arrangement keeps hosting credentials in their existing repository. No key needs to be copied to the public tool repository or recovered in plaintext. Build releases are published only from successful main-branch push CI runs, with source commit and SHA-256 checksum. Pull-request runs cannot publish distributions.

The portfolio deployment must preserve the tool directory:

```yaml
EXCLUDE: '.git/, .github/, tools/dxf-print/'
```

Both changes are in the portfolio integration pull request. The hosting workflow pins the SSH action to a reviewed commit and uses SSH's initial host enrollment (`accept-new`), matching the existing hosting account. For stronger host identity pinning, provision a verified known_hosts entry as described below.

## Alternative: direct deployment from this repository

A direct SiteGround workflow is also provided but disabled by default. Use this option if hosting credentials are deliberately provisioned in this repository in the future. Disable the hosting-repository poller before switching so only one deployment path is active.

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

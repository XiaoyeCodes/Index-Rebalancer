# Private market-data scheduler

**Goal:** Remove dependence on a public repository's scheduled workflow so its 60-day inactivity rule cannot stop market-data updates.

**Architecture:** A private repository runs the existing real-data updater daily at 09:17 Asia/Shanghai, with an independent 11:47 same-day fallback. A dedicated SSH deploy key restricted to the public app repository permits committing validated data. That push triggers the existing Pages workflow. No personal access token, empty commits, or keepalive action is used. Holidays retain the latest available trading date.

## Implementation and verification

1. Create a private automation repository and add the scheduled workflow and operating documentation.
2. Generate a dedicated SSH deploy key, add its public half to the application repository, and store its private half as the private scheduler's Actions secret. Never commit or print private key material. Remove the local temporary key after setup.
3. Run the private workflow manually. Verify SSH read/write access, real data download and validation, data push or a valid unchanged result, and the public website's deployment after a changed-data push.
4. Remove the public updater's schedule only after the private workflow has succeeded. Retain its manual fallback and existing workflow_run deployment hook.
5. Verify repository visibility and active workflow states. Document run URLs and the remaining platform, quota, credential, and data-source limitations.

The current GitHub documentation states that automatic disabling after 60 days without repository activity applies to **public** repositories. Private runs use the account's included Actions compute quota. These facts do not provide an uptime guarantee for third-party services.

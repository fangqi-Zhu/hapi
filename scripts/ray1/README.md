# Ray1 custom HAPI

This branch is based on upstream `tiann/hapi` release `v0.23.3`.

The customization is deliberately narrow:

- the remote Terminal uses the full available content width and height;
- the Terminal header has a native browser fullscreen toggle;
- xterm refits after container, window, and fullscreen changes;
- browser copy remains available when xterm has a selection;
- the remote Terminal uses Ghostty's default background, foreground, and
  16-color palette, without the mobile quick-input button bar;
- HAPI terminals open a plain Bash shell in `/workspace`, so an existing
  Zellij session can be attached directly without nesting it inside another
  Zellij client;
- the embedded custom web build can be served from the existing
  `relay.hapi.run` tunnel with `HAPI_SERVE_WEB_IN_RELAY=1`.

No Hub database, API token, tunnel identity, or HAPI configuration file is
stored in this repository or replaced by the installer.

## One-command restore on a new ray1

```bash
git clone --branch custom/ray1-terminal https://github.com/fangqi-Zhu/hapi.git /workspace/hapi-custom \
  && /workspace/hapi-custom/scripts/ray1/bootstrap-ray1-hapi.sh
```

If the repository already exists:

```bash
/workspace/hapi-custom/scripts/ray1/bootstrap-ray1-hapi.sh
```

## Build, install, and rollback

```bash
cd /workspace/hapi-custom
scripts/ray1/build-custom-hapi.sh
scripts/ray1/install-custom-hapi.sh --activate
```

The official npm-installed executable is retained as
`/root/.local/bin/hapi-official`. Every activation also records a timestamped
backup under `/root/.local/share/hapi-custom/backups/`, including a consistent
SQLite snapshot plus the existing Hub settings, token, and relay identity.

Rollback:

```bash
/workspace/hapi-custom/scripts/ray1/rollback-hapi.sh --activate
```

Service status and logs:

```bash
/root/bin/manage-hapi-services status
/root/bin/manage-hapi-services logs
```

The custom build reports `0.23.3-fangqi.1`, while protocol compatibility
remains the same as upstream `v0.23.3`.

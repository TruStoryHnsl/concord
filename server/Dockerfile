FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Reticulum runtime — ON by default; part of the standard image. The
# Reticulum Network Stack daemon `rnsd` is installed via pip so it is
# discoverable on PATH — this is the "external runtime dependency"
# decision (rns is NOT bundled into binaries; the image provides it).
# Gating this off-by-default shipped images whose reticulum surface was
# dead code. Override to 0 only for an explicitly minimal build.
ARG CONCORD_INSTALL_RNS=1
# Pinned to the version the wire format + pillar node were validated
# against (docs/reticulum/deployment.md; engine live-validated rns 1.4.2).
ARG CONCORD_RNS_VERSION=1.4.2
RUN if [ "$CONCORD_INSTALL_RNS" = "1" ]; then \
      pip install --no-cache-dir "rns==${CONCORD_RNS_VERSION}" && rnsd --version; \
    fi

COPY . .

# --limit-concurrency bounds simultaneous in-flight connections (excess
# gets 503 instead of exhausting the worker); --timeout-keep-alive drops
# idle keep-alives quickly under connection floods. (2026-08-12
# protections pass.)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "512", "--timeout-keep-alive", "15"]

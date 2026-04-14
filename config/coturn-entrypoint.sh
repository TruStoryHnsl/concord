#!/bin/sh
set -eu

if [ -z "${TURN_SECRET:-}" ]; then
  echo "TURN_SECRET is required" >&2
  exit 1
fi

set -- \
  --static-auth-secret="${TURN_SECRET}" \
  --realm="${TURN_DOMAIN:-localhost}"

if [ -n "${TURN_EXTERNAL_IP:-}" ]; then
  set -- "$@" "--external-ip=${TURN_EXTERNAL_IP}"
fi

if [ "${TURN_TLS_ENABLED:-false}" = "true" ]; then
  if [ -z "${TURN_TLS_CERT_FILE:-}" ] || [ -z "${TURN_TLS_KEY_FILE:-}" ]; then
    echo "TURN_TLS_ENABLED=true requires TURN_TLS_CERT_FILE and TURN_TLS_KEY_FILE" >&2
    exit 1
  fi

  set -- "$@" \
    "--tls-listening-port=${TURN_TLS_PORT:-5349}" \
    "--cert=${TURN_TLS_CERT_FILE}" \
    "--pkey=${TURN_TLS_KEY_FILE}"
fi

exec turnserver -c /etc/turnserver.conf "$@"

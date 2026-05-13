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

TURN_LISTEN_IP_VALUE="${TURN_LISTEN_IP:-}"
TURN_RELAY_IP_VALUE="${TURN_RELAY_IP:-}"

if [ -z "${TURN_LISTEN_IP_VALUE}" ] || [ -z "${TURN_RELAY_IP_VALUE}" ]; then
  case "${TURN_EXTERNAL_IP:-}" in
    */*)
      TURN_PRIVATE_IP_VALUE="${TURN_EXTERNAL_IP#*/}"
      if [ -n "${TURN_PRIVATE_IP_VALUE}" ]; then
        if [ -z "${TURN_LISTEN_IP_VALUE}" ]; then
          TURN_LISTEN_IP_VALUE="${TURN_PRIVATE_IP_VALUE}"
        fi
        if [ -z "${TURN_RELAY_IP_VALUE}" ]; then
          TURN_RELAY_IP_VALUE="${TURN_PRIVATE_IP_VALUE}"
        fi
      fi
      ;;
  esac
fi

if [ -n "${TURN_LISTEN_IP_VALUE}" ]; then
  set -- "$@" "--listening-ip=${TURN_LISTEN_IP_VALUE}"
fi

if [ -n "${TURN_RELAY_IP_VALUE}" ]; then
  set -- "$@" "--relay-ip=${TURN_RELAY_IP_VALUE}"
fi

# Optional comma-separated list of additional peer IPs to allow as
# relay destinations. Required when LiveKit runs in network_mode: host
# bound on the operator's LAN IP — coturn's denied-peer-ip defaults
# block 192.168.0.0/16, so the specific host LAN IP must be
# whitelisted explicitly or coturn silently drops LiveKit's STUN
# binding requests. Empty = no additional --allowed-peer-ip flags.
if [ -n "${TURN_ALLOWED_PEER_IPS:-}" ]; then
  OLD_IFS="$IFS"
  IFS=','
  for peer in ${TURN_ALLOWED_PEER_IPS}; do
    peer="$(echo "$peer" | tr -d '[:space:]')"
    if [ -n "$peer" ]; then
      set -- "$@" "--allowed-peer-ip=$peer"
    fi
  done
  IFS="$OLD_IFS"
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
else
  set -- "$@" --no-tls --no-dtls
fi

exec turnserver -c /etc/turnserver.conf "$@"

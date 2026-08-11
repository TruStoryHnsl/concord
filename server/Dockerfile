FROM python:3.14-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Reticulum Transport (INS-037), OFF by default. When built with
# --build-arg CONCORD_INSTALL_RNS=1 (set by docker-compose.reticulum.yml)
# the Reticulum Network Stack daemon `rnsd` is installed into the image via
# pip so it is discoverable on PATH — this is the "external runtime
# dependency" decision (rns is NOT bundled; the host/image provides it).
# With the default value (0) this is a no-op and the image is unchanged.
ARG CONCORD_INSTALL_RNS=0
RUN if [ "$CONCORD_INSTALL_RNS" = "1" ]; then \
      pip install --no-cache-dir rns && rnsd --version; \
    fi

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

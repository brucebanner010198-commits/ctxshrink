# ctxshrink: dual Python + JavaScript CLI/dashboard in one image.
#
# The Python package needs no third-party dependencies at runtime, and the
# JS package needs none either (js-tiktoken is an optional exact-token
# backend, not required). So this image just needs a Python and a Node
# interpreter plus the source tree; there is nothing to `pip install` or
# `npm install` for the default path.

FROM python:3.12-slim

# Unbuffered stdout: without this, print() output (including the dashboard's
# startup line) sits in a buffer until it fills or the process exits when
# stdout is not a TTY, which is always true under `docker run`/`docker logs`.
ENV PYTHONUNBUFFERED=1

LABEL org.opencontainers.image.title="ctxshrink" \
      org.opencontainers.image.description="Shrink prompts and code context for AI coding assistants" \
      org.opencontainers.image.licenses="MIT"

# Node.js, to run the JavaScript CLI. npm is deliberately not installed:
# the JS package has no required dependencies, so nothing here ever runs
# `npm install`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml README.md ./
COPY python ./python
COPY benchmarks ./benchmarks
COPY dashboard ./dashboard
RUN pip install --no-cache-dir --no-compile .

COPY js ./js

ENV CTXSHRINK_HOME=/app
EXPOSE 8877

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["dashboard", "--host", "0.0.0.0", "--no-browser"]
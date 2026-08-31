#!/bin/sh
# Dispatches to the Python CLI by default, or the JS CLI when the first
# argument is "js". This keeps both packages usable from one image without
# forcing a choice at build time.
#
#   docker run ctxshrink dashboard --host 0.0.0.0
#   docker run ctxshrink compress --level 2 < file.py
#   docker run ctxshrink js compress --level 2 < file.py
#   docker run ctxshrink js benchmark
set -e

if [ "$1" = "js" ]; then
  shift
  exec node /app/js/bin/ctxshrink.mjs "$@"
fi

if [ "$1" = "sh" ] || [ "$1" = "bash" ]; then
  exec "$@"
fi

exec python3 -m ctxshrink.cli "$@"
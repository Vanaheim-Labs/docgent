# DocForge render worker
# pandoc + WeasyPrint + fonts, behind a small HTTP API.
#
# WeasyPrint needs Pango/Cairo/HarfBuzz native libs, which is precisely why this
# cannot run on Vercel. Keep this image as the single source of render truth.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DEBIAN_FRONTEND=noninteractive

# --- system deps -----------------------------------------------------------
# libpango/libcairo/libgdk-pixbuf: WeasyPrint rendering backend
# fonts-*: baseline coverage so text never silently falls back to tofu
RUN apt-get update && apt-get install -y --no-install-recommends \
      pandoc \
      libpango-1.0-0 \
      libpangoft2-1.0-0 \
      libharfbuzz0b \
      libcairo2 \
      libgdk-pixbuf-2.0-0 \
      libffi8 \
      shared-mime-info \
      fonts-dejavu-core \
      fonts-liberation2 \
      fontconfig \
      curl \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- brand fonts -----------------------------------------------------------
# Brand typography must be embedded in the image; assuming host fonts is how
# you get a PDF that looks right locally and wrong in production.
COPY fonts/ /usr/local/share/fonts/docforge/
RUN fc-cache -f -v > /dev/null 2>&1 || true

# --- python deps -----------------------------------------------------------
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# --- app -------------------------------------------------------------------
WORKDIR /app
COPY server.py /app/server.py

# Pipeline assets shipped from the monorepo (see build context note in fly.toml)
COPY pipeline/ /app/pipeline/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", \
     "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "server:app"]

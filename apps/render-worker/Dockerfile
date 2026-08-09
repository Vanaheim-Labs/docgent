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
#
# NOTE: pandoc is NOT installed from apt. Debian bookworm ships 2.17, which
# predates extensions the pipeline relies on (table_attributes and friends),
# so an apt build renders locally but 422s in production. Pin the release
# below and keep it in step with the extension list in packages/core.
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# --- pandoc (pinned) -------------------------------------------------------
ARG PANDOC_VERSION=3.9
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) pandoc_arch="amd64" ;; \
      arm64) pandoc_arch="arm64" ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/pandoc.deb \
      "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-1-${pandoc_arch}.deb"; \
    dpkg -i /tmp/pandoc.deb; \
    rm -f /tmp/pandoc.deb; \
    pandoc --version | head -1

# --- brand fonts -----------------------------------------------------------
# Brand typography must be embedded in the image; assuming host fonts is how
# you get a PDF that looks right locally and wrong in production.
#
# Shipped (both SIL OFL 1.1, embedding permitted):
#   Inter 4.1              -> variable, Roman + Italic
#   Source Serif 4.005     -> variable, Roman + Italic
# Variable fonts cover the full weight axis in one file, so the image stays
# small and CSS font-weight works across the whole range.
COPY fonts/ /usr/local/share/fonts/docforge/

# Brand-specific faces, staged from brands/<id>/fonts by stage.mjs.
COPY pipeline/fonts/ /usr/local/share/fonts/docforge-brands/

# Alias design-intent family names onto the variable-font family names the
# binaries actually register under. Without this fontconfig falls back to
# DejaVu/Liberation and every build still reports success.
COPY fontconfig/49-docforge-aliases.conf /etc/fonts/conf.d/49-docforge-aliases.conf

RUN fc-cache -f > /dev/null 2>&1 || true; \
    fc-match "Inter" | grep -qi "inter" || (echo "FONT ALIAS FAILED: Inter" >&2; exit 1); \
    fc-match "Source Serif 4" | grep -qi "sourceserif" || (echo "FONT ALIAS FAILED: Source Serif 4" >&2; exit 1); \
    fc-match "Cormorant Garamond" | grep -qi "cormorant" || (echo "FONT MISSING: Cormorant Garamond (North Face)" >&2; exit 1); \
    echo "font aliases verified"

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

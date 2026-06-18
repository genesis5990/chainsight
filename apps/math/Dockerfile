# Dockerfile for the ChainSight Math Service (Python 3.12 + FastAPI).

FROM python:3.12-slim AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN pip install --no-cache-dir uv
WORKDIR /app

FROM base AS deps
COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

FROM base AS runner
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin
COPY src/ ./src/

RUN useradd -m -u 1001 chainsight
USER chainsight
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8081/health').read()" || exit 1

CMD ["python", "-m", "uvicorn", "chainsight_math.main:app", "--host", "0.0.0.0", "--port", "8081"]

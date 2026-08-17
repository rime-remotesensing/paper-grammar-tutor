FROM python:3.12.3-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY services/pymupdf_layout/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY services/pymupdf_layout/main.py ./main.py

EXPOSE 8009
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8009"]

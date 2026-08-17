FROM paddlepaddle/paddle:3.3.1-gpu-cuda12.9-cudnn9.9

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY services/paddle_ocr/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY services/paddle_ocr/main.py ./main.py

EXPOSE 8008
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8008"]

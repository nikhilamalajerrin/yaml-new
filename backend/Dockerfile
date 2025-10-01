FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# If you need it (your file had it), leave this:
RUN pip install --no-cache-dir openai

COPY . .

# Default CORS origin for local UI; override via compose/env if needed
ENV ALLOWED_ORIGINS=http://localhost:8080

EXPOSE 8000
# uvicorn is started by docker-compose or you can uncomment:
# CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

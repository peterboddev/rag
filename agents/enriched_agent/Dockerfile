# Enriched Summary Agent Dockerfile
# Uses direct boto3 calls to Bedrock, DynamoDB, and Knowledge Base APIs

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY agent.py .

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Default environment variables (can be overridden at runtime)
ENV DOCUMENTS_TABLE=rag-app-documents-dev
ENV KNOWLEDGE_BASE_ID=rag-app-v2-kb-dev
ENV GRAPH_RAG_KNOWLEDGE_BASE_ID=""
ENV BEDROCK_REGION=us-east-1
ENV BEDROCK_MODEL_ID=amazon.nova-pro-v1:0

# Run the agent
CMD ["python", "agent.py"]

# Tharavu Dappa - Docker Deployment Guide

## Overview
Tharavu Dappa is a visual data science pipeline builder that allows users to create sophisticated data processing workflows using pandas functions with VS Code-like intellisense.

## Features
- 🔍 **VS Code-like Function Search**: Intelligent search for pandas functions with parameter details
- 📁 **Auto CSV Loading**: Automatically creates `read_csv("filename")` nodes when files are uploaded  
- 🔗 **DAG Workflow**: Visual directed acyclic graph where outputs connect as inputs to other functions
- ⚙️ **Parameter Selection**: Interactive parameter selection for each function
- 🐳 **Docker Ready**: Full containerization support for easy deployment

## Quick Start with Docker

### Option 1: Docker Compose (Recommended)
```bash
# Clone the repository
git clone <your-repo-url>
cd tharavu-dappa

# Start the application
docker-compose up -d

# Access the application
open http://localhost:3000
```

### Option 2: Docker Build
```bash
# Build the image
docker build -t tharavu-dappa .

# Run the container
docker run -p 3000:80 -v $(pwd)/data:/app/data tharavu-dappa

# Access the application
open http://localhost:3000
```

## Application Usage

### 1. Upload Data File
- Click "Upload Data File" button
- Select CSV, Excel, or Text file
- System automatically creates `read_csv("filename")` node

### 2. Search Functions
- Click "Add Function" button  
- Search functions like VS Code intellisense
- Type function names (e.g., `dropna`, `groupby`) or descriptions
- Functions are categorized (IO, Cleaning, Grouping, etc.)

### 3. Configure Parameters
- Click on any function node
- Select which parameters you want to configure
- Set parameter values
- Required parameters are marked clearly

### 4. Build DAG Pipeline
- Functions automatically connect as DAG
- Output of one function becomes input to next
- Visual flow shows data transformation pipeline
- YAML configuration updates in real-time

### 5. Execute Pipeline
- Click "Run Pipeline" to execute
- Downloads processed data as CSV
- View intermediate results by double-clicking nodes

## Backend API (Optional)

The backend service provides real-time pandas function introspection:

```bash
# Access pandas functions API
curl http://localhost:8000/pandas/functions

# Search specific functions
curl http://localhost:8000/pandas/search?query=groupby

# Get function details
curl http://localhost:8000/pandas/function/read_csv
```

## Development

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start backend (optional)
cd backend
pip install -r requirements.txt
python main.py
```

### Environment Variables
```bash
# Frontend
VITE_API_URL=http://localhost:8000

# Backend  
PYTHONPATH=/app
```

## Production Deployment

### Docker Compose Production
```yaml
version: '3.8'
services:
  tharavu-dappa:
    image: tharavu-dappa:latest
    ports:
      - "80:80"
    environment:
      - NODE_ENV=production
    volumes:
      - ./data:/app/data
    restart: always
```

### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tharavu-dappa
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tharavu-dappa
  template:
    metadata:
      labels:
        app: tharavu-dappa
    spec:
      containers:
      - name: tharavu-dappa
        image: tharavu-dappa:latest
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: tharavu-dappa-service
spec:
  selector:
    app: tharavu-dappa
  ports:
  - port: 80
    targetPort: 80
  type: LoadBalancer
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Data Storage  │
│   (React/Vite)  │────│   (FastAPI)     │────│   (Volume)      │
│   Port: 3000    │    │   Port: 8000    │    │   ./data        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Troubleshooting

### Common Issues
1. **Port conflicts**: Change ports in docker-compose.yml
2. **File upload issues**: Check volume mounting in Docker
3. **Backend connection**: Verify CORS settings and network connectivity

### Logs
```bash
# View application logs
docker-compose logs -f tharavu-dappa

# View backend logs  
docker-compose logs -f pandas-backend
```

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
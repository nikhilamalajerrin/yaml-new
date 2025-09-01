# THARAVU_DAPPA


![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)
![Langchain](https://img.shields.io/badge/langchain-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)
![HuggingFace](https://img.shields.io/badge/-HuggingFace-FDEE21?style=for-the-badge&logo=HuggingFace&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![JSON](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=JSON%20web%20tokens&logoColor=white)

👨‍💻 Programmer: "மச்சி, எல்லா வேலையும் ஒரே script-ல automate பண்ணிடுவேன்னு சொன்னியே?"

🤖 Workflow System: "நீ manual-ஆ செய்யற வேலையை பாத்தா, நானும் while(True) loop போட்டு ஓடனும் போல! 🤣"

# 🛠 YAML-DAG based Workflow Engine

This project is a **declarative YAML-based workflow engine** that allows users to define, visualize, and execute data processing pipelines interactively. It integrates **Polars, NetworkX, and PyVis** to provide a structured and dynamic workflow execution system. This also includes a lightweight Business Intelligence (BI) application that transforms natural-language questions into PostgreSQL queries using Vanna (RAG + LLM). It executes the SQL and provides options to visualize results as charts or export them as CSV files.

## 🚀 Features

Backend: FastAPI router (/vanna/v0/*) integrates Vanna with either Ollama (local) + ChromaDB or Vanna Cloud.
Frontend: Vite + React UI (VannamBI.tsx) includes:
Editable SQL editor
Options to run SQL, generate charts, or download results as CSV
Tools to mark correct or fix & save SQL to improve the model
Training drawer for adding DDL, documentation, or question-SQL pairs


Training: Automatically trains on INFORMATION_SCHEMA.COLUMNS or supports manual training with DDL, documentation, or question-SQL pairs.

Prerequisites

Node.js: Version 18 or higher (20+ recommended)
Python: Version 3.10 or higher
PostgreSQL: Version 13 or higher with a database you can connect to (Pagila sample recommended)
One of:
```bash
Ollama (for local development):brew install ollama
ollama serve
ollama pull mistral
```
Default model: mistral:latest.
Vanna Cloud: Requires VANNA_MODEL and VANNA_API_KEY credentials.

Optional: psql CLI for loading the Pagila sample database.

To use the Pagila sample database, download pagila-schema.sql (and optionally pagila-data.sql) from a source like PostgreSQL Sample Database.
Environment Variables
Create a .env file in the project root. The backend reads these directly, and the dev server typically loads them via your process manager or shell.
Database Configuration

# Preferred (used for auto-connect and auto-training):
```bash
VANNA_DATA_PG_HOST=localhost
VANNA_DATA_PG_DB=pagila
VANNA_DATA_PG_USER=postgres
VANNA_DATA_PG_PASSWORD=postgres
VANNA_DATA_PG_PORT=5432
VANNA_DATA_PG_SSLMODE=disable
```
# Fallback (if DATA_* not provided):
VANNA_PG_HOST, VANNA_PG_DB, VANNA_PG_USER, VANNA_PG_PASSWORD, VANNA_PG_PORT, VANNA_PG_SSLMODE

LLM + Vector Store
Choose one option

✅ **YAML-defined workflows** – Easily create tasks using YAML  
✅ **Dynamic Flow Visualization** – Interactive dependency graph for task execution  
✅ **Task Execution Monitoring** – See live execution status and outputs  
✅ **Integrated Data Cleaning** – Supports Polars-based data processing  

---

📌 **Note**: These images are samples and would be implemented with React or Ruby on Rails. The script is as of now written in python but further would be done with Rust

---

## 🏗 **How to Use**

### 1️⃣ Install Dependencies
```bash
brew install ollama
ollama serve
ollama pull mistral
```

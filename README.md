# THARAVU_DAPPA

![openmldb_logo](docs/en/about/images/openmldb_logo.png)

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)
![Langchain]https://img.shields.io/badge/langchain-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white
![HuggingFace]https://img.shields.io/badge/-HuggingFace-FDEE21?style=for-the-badge&logo=HuggingFace&logoColor=black
![TypeScript]https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white
![React]https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
![JSON]https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=JSON%20web%20tokens&logoColor=white

👨‍💻 Programmer: "மச்சி, எல்லா வேலையும் ஒரே script-ல automate பண்ணிடுவேன்னு சொன்னியே?"

🤖 Workflow System: "நீ manual-ஆ செய்யற வேலையை பாத்தா, நானும் while(True) loop போட்டு ஓடனும் போல! 🤣"

# 🛠 YAML-DAG based Workflow Engine

This project is a **declarative YAML-based workflow engine** that allows users to define, visualize, and execute data processing pipelines interactively. It integrates **Polars, NetworkX, and PyVis** to provide a structured and dynamic workflow execution system.

## 🚀 Features

✅ **YAML-defined workflows** – Easily create tasks using YAML  
✅ **Dynamic Flow Visualization** – Interactive dependency graph for task execution  
✅ **Task Execution Monitoring** – See live execution status and outputs  
✅ **Integrated Data Cleaning** – Supports Polars-based data processing  

---

## 📸 Screenshots

### 1️⃣ **Workflow Execution Interface**
![Workflow Execution](/img2.png)

### 2️⃣ **Task Execution Status**
![Task Status](/img1.png)

📌 **Note**: These images are samples and would be implemented with React or Ruby on Rails. The script is as of now written in python but further would be done with Rust

---

## 🏗 **How to Use**

### 1️⃣ Install Dependencies
```bash
pip install streamlit polars networkx pyvis pyyaml

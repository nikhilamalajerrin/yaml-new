// src/lib/vanna.ts
import { API_BASE, getJson } from "./api";

function join(base: string, path: string) {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

async function postJson<T>(path: string, body: any): Promise<T> {
  const res = await fetch(join(API_BASE, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

export type SqlResp = { type: "sql"; id: string; text: string };
export type DfResp = { type: "df"; id: string; df: string }; // df is JSON string (records)
export type FigResp = { type: "plotly_figure"; id: string; fig: string };
export type QList = { type: "question_list"; id?: string; header?: string; questions: string[] };
export type TrainData = { type: "df"; id: "training_data"; df: string };
export type Success = { success: true } | { type: "error"; error: string };

export const vanna = {
  // connections
  connectPostgres: (payload: {
    host: string; port?: number; dbname: string; user: string; password: string;
  }) => postJson<Success>("/vanna/v0/connect/postgres", payload),
  connectionStatus: () => getJson<{ connected: boolean; engine?: string; details?: any }>(
    join(API_BASE, "/vanna/v0/connection_status")
  ),

  // core flow
  generateQuestions: () => getJson<QList>(join(API_BASE, "/vanna/v0/generate_questions")),
  generateSql: (question: string) =>
    getJson<SqlResp>(join(API_BASE, `/vanna/v0/generate_sql?question=${encodeURIComponent(question)}`)),
  runSql: (id: string) =>
    getJson<DfResp>(join(API_BASE, `/vanna/v0/run_sql?id=${encodeURIComponent(id)}`)),
  figure: (id: string) =>
    getJson<FigResp>(join(API_BASE, `/vanna/v0/generate_plotly_figure?id=${encodeURIComponent(id)}`)),
  followups: (id: string) =>
    getJson<QList>(join(API_BASE, `/vanna/v0/generate_followup_questions?id=${encodeURIComponent(id)}`)),
  downloadCsvUrl: (id: string) => join(API_BASE, `/vanna/v0/download_csv?id=${encodeURIComponent(id)}`),

  // training
  getTrainingData: () => getJson<TrainData>(join(API_BASE, "/vanna/v0/get_training_data")),
  train: (payload: { question?: string; sql?: string; ddl?: string; documentation?: string }) =>
    postJson<{ id: string } | { type: "error"; error: string }>("/vanna/v0/train", payload),
  removeTrainingData: (id: string) =>
    postJson<Success>("/vanna/v0/remove_training_data", { id }),
};

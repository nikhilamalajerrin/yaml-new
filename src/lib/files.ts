// src/lib/files.ts
export function basename(pathOrName: string) {
    if (!pathOrName) return "";
    return pathOrName.split(/[\\/]/).pop() || pathOrName;
  }
  
  export function findUploadedFile(
    typed: string,
    files: Record<string, File>
  ): File | null {
    if (!typed) return null;
    const needle = typed.trim();
    const nameCI = needle.toLowerCase();
    const base = basename(needle).toLowerCase();
  
    // exact key
    if (files[needle]) return files[needle];
  
    // case-insensitive key
    for (const [k, f] of Object.entries(files)) {
      if (k.toLowerCase() === nameCI) return f;
    }
  
    // basename match (case-insensitive)
    for (const [k, f] of Object.entries(files)) {
      if (basename(k).toLowerCase() === base) return f;
    }
  
    return null;
  }
  
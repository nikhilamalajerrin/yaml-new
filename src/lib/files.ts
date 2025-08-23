// // src/lib/files.ts
// export function basename(pathOrName: string) {
//     if (!pathOrName) return "";
//     return pathOrName.split(/[\\/]/).pop() || pathOrName;
//   }
  
//   export function findUploadedFile(
//     typed: string,
//     files: Record<string, File>
//   ): File | null {
//     if (!typed) return null;
//     const needle = typed.trim();
//     const nameCI = needle.toLowerCase();
//     const base = basename(needle).toLowerCase();
  
//     // exact key
//     if (files[needle]) return files[needle];
  
//     // case-insensitive key
//     for (const [k, f] of Object.entries(files)) {
//       if (k.toLowerCase() === nameCI) return f;
//     }
  
//     // basename match (case-insensitive)
//     for (const [k, f] of Object.entries(files)) {
//       if (basename(k).toLowerCase() === base) return f;
//     }
  
//     return null;
//   }

// src/lib/files.ts

/** Return the basename (last path segment) of a path or filename. */
export function basename(pathOrName: string): string {
  if (!pathOrName) return "";
  return pathOrName.split(/[\\/]/).pop() || pathOrName;
}

/**
 * Try to find a previously uploaded File by a user-typed string.
 * Matches by:
 *  1) exact key in the files map
 *  2) case-insensitive key
 *  3) case-insensitive basename match
 */
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

/* ------------------------------------------------------------------------------------
   Simple global "selected file" bus so Data Sources can set it and the Pipeline Editor
   can react to it without routing. Import { setSelectedFile, getSelectedFile, onSelectedFile }
   from anywhere in the app.
------------------------------------------------------------------------------------- */

type FileListener = (file: File | null) => void;

let _selectedFile: File | null = null;
const _listeners = new Set<FileListener>();

/** Set the globally-selected file and notify listeners. */
export function setSelectedFile(file: File | null): void {
  _selectedFile = file || null;
  _listeners.forEach((l) => l(_selectedFile));
}

/** Read the current globally-selected file (may be null). */
export function getSelectedFile(): File | null {
  return _selectedFile;
}

/** Subscribe to changes of the globally-selected file. Returns an unsubscribe fn. */
export function onSelectedFile(listener: FileListener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

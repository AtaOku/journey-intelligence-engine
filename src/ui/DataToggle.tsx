import React, { useRef, useState } from 'react';

interface Props {
  mode: 'showcase' | 'upload';
  onModeChange: (mode: 'showcase' | 'upload') => void;
  onFileUpload: (csvText: string) => void;
  uploadStatus?: { sessions: number; warnings: string[] } | null;
  isProcessing?: boolean;
}

export function DataToggle({ mode, onModeChange, onFileUpload, uploadStatus, isProcessing }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') {
        onFileUpload(text);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
        <button
          onClick={() => onModeChange('showcase')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === 'showcase'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          Showcase data
        </button>
        <button
          onClick={() => onModeChange('upload')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            mode === 'upload'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
          }`}
        >
          Upload CSV
        </button>
      </div>

      {/* File upload (only in upload mode) */}
      {mode === 'upload' && (
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isProcessing}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : fileName ? 'Change file' : 'Choose CSV file'}
          </button>
          {fileName && !isProcessing && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {fileName}
            </span>
          )}
        </div>
      )}

      {/* Upload status */}
      {mode === 'upload' && uploadStatus && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          {uploadStatus.sessions.toLocaleString()} sessions loaded
        </span>
      )}

      {/* Warnings */}
      {mode === 'upload' && uploadStatus?.warnings.length ? (
        <span className="text-xs text-amber-600 dark:text-amber-400">
          {uploadStatus.warnings[0]}
        </span>
      ) : null}
    </div>
  );
}

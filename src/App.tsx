import React, { useState, useEffect, useCallback } from 'react';
import { StaticDataSource } from './api/staticDataSource';
import { ClientSideDataSource } from './api/clientSideDataSource';
import { SummaryStats } from './ui/SummaryStats';
import { SankeyCanvas } from './ui/SankeyCanvas';
import { PatternTable } from './ui/PatternTable';
import { FrictionCards } from './ui/FrictionCards';
import { DataToggle } from './ui/DataToggle';
import type { Metadata, SankeyData, PatternData, FrictionData } from './api/types';

const staticSource = new StaticDataSource();

type DataMode = 'showcase' | 'upload';
type ViewTab = 'journey' | 'patterns';

export default function App() {
  const [mode, setMode] = useState<DataMode>('showcase');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [sankeyData, setSankeyData] = useState<SankeyData | null>(null);
  const [patterns, setPatterns] = useState<PatternData | null>(null);
  const [friction, setFriction] = useState<FrictionData | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('journey');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    sessions: number;
    warnings: string[];
  } | null>(null);

  useEffect(() => {
    loadShowcaseData();
  }, []);

  async function loadShowcaseData() {
    setLoading(true);
    setError(null);
    try {
      const [meta, sankey, pat, fric] = await Promise.all([
        staticSource.getMetadata(),
        staticSource.getSankeyData(),
        staticSource.getPatterns(),
        staticSource.getFrictionData(),
      ]);
      setMetadata(meta);
      setSankeyData(sankey);
      setPatterns(pat);
      setFriction(fric);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  const handleModeChange = useCallback((newMode: DataMode) => {
    setMode(newMode);
    if (newMode === 'showcase') {
      loadShowcaseData();
      setUploadStatus(null);
    }
  }, []);

  const handleFileUpload = useCallback((csvText: string) => {
    setIsProcessing(true);
    setError(null);

    setTimeout(() => {
      try {
        const source = new ClientSideDataSource();
        source.process(csvText);

        if (source.warnings.length > 0 && source.format === 'unknown') {
          setError(source.warnings.join('. '));
          setIsProcessing(false);
          return;
        }

        Promise.all([
          source.getMetadata(),
          source.getSankeyData(),
          source.getPatterns(),
          source.getFrictionData(),
        ]).then(([meta, sankey, pat, fric]) => {
          setMetadata(meta);
          setSankeyData(sankey);
          setPatterns(pat);
          setFriction(fric);
          setUploadStatus({
            sessions: meta.total_sessions,
            warnings: source.warnings,
          });
          setIsProcessing(false);
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to process CSV');
        setIsProcessing(false);
      }
    }, 50);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading journey data...</p>
        </div>
      </div>
    );
  }

  if (error && !metadata) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center text-red-600 max-w-md">
          <p className="text-lg font-medium">Error loading data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Journey Intelligence Engine</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Path-level journey analysis with friction detection
              </p>
            </div>
            <DataToggle
              mode={mode}
              onModeChange={handleModeChange}
              onFileUpload={handleFileUpload}
              uploadStatus={uploadStatus}
              isProcessing={isProcessing}
            />
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-6">
        {error && metadata && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            {error}
          </div>
        )}

        {metadata && friction && <SummaryStats metadata={metadata} friction={friction} />}

        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('journey')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'journey'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Journey canvas
          </button>
          <button
            onClick={() => setActiveTab('patterns')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'patterns'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            Pattern intelligence
          </button>
        </div>

        {activeTab === 'journey' && sankeyData && friction && (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <SankeyCanvas data={sankeyData} friction={friction} />
          </div>
        )}

        {activeTab === 'patterns' && (
          <div className="space-y-6">
            {friction && <FrictionCards friction={friction} />}
            {patterns ? (
              <PatternTable patterns={patterns} />
            ) : (
              mode === 'upload' && (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Pattern mining is available in showcase mode only.
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
                    Sequential pattern mining requires server-side computation.
                    Friction detection and journey flow work fully in upload mode.
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-gray-200 dark:border-gray-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between text-xs text-gray-400 dark:text-gray-600">
          <span>Journey Intelligence Engine · MarTech × AI Portfolio</span>
          <a
            href="https://github.com/AtaOku/journey-intelligence-engine"
            className="hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

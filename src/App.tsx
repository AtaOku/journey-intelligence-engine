import React, { useState, useEffect, useCallback } from 'react';
import { StaticDataSource } from './api/staticDataSource';
import { ClientSideDataSource } from './api/clientSideDataSource';
import type { ValidationReport } from './engine/validation';
import { computeMarkovAnalytics, type MarkovAnalytics } from './engine/markovAnalytics';
import { SummaryStats } from './ui/SummaryStats';
import { SankeyCanvas } from './ui/SankeyCanvas';
import { PatternTable } from './ui/PatternTable';
import { FrictionCards } from './ui/FrictionCards';
import { MarkovInsights } from './ui/MarkovInsights';
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
  const [processingStage, setProcessingStage] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<{
    sessions: number;
    warnings: string[];
  } | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [markovData, setMarkovData] = useState<MarkovAnalytics | null>(null);

  useEffect(() => {
    loadShowcaseData();
  }, []);

  async function loadShowcaseData() {
    setLoading(true);
    setError(null);
    try {
      const [meta, sankey, pat, fric, matrices] = await Promise.all([
        staticSource.getMetadata(),
        staticSource.getSankeyData(),
        staticSource.getPatterns(),
        staticSource.getFrictionData(),
        staticSource.getTransitionMatrices(),
      ]);
      setMetadata(meta);
      setSankeyData(sankey);
      setPatterns(pat);
      setFriction(fric);
      setMarkovData(computeMarkovAnalytics(matrices));
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
      setValidation(null);
    }
  }, []);

  const handleFileUpload = useCallback(async (csvText: string) => {
    setIsProcessing(true);
    setError(null);
    setProcessingStage('Starting...');

    try {
      const source = new ClientSideDataSource();
      await source.processAsync(csvText, (stage, _pct) => {
        setProcessingStage(stage);
      });

      if (source.warnings.length > 0 && source.format === 'unknown') {
        setError(source.warnings.join('. '));
        setIsProcessing(false);
        setProcessingStage('');
        return;
      }

      const [meta, sankey, pat, fric] = await Promise.all([
        source.getMetadata(),
        source.getSankeyData(),
        source.getPatterns(),
        source.getFrictionData(),
      ]);

      setMetadata(meta);
      setSankeyData(sankey);
      setPatterns(pat);
      setFriction(fric);
      // Markov analytics already computed in worker (or sync fallback)
      setMarkovData(source.getMarkov());
      setValidation(source.getValidation());
      setUploadStatus({
        sessions: meta.total_sessions,
        warnings: source.warnings,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to process CSV');
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
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
              processingStage={processingStage}
            />
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-6">
        {mode === 'showcase' && (
          <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 px-4 py-2.5 text-xs text-indigo-700 dark:text-indigo-400 flex items-center gap-2">
            <span className="font-medium">Demo data</span>
            <span className="text-indigo-500 dark:text-indigo-500">—</span>
            <span>10K synthetic sessions with embedded friction patterns for illustration. Upload your own CSV to analyze real journeys.</span>
          </div>
        )}

        {error && metadata && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
            {error}
          </div>
        )}

        {metadata && friction && <SummaryStats metadata={metadata} friction={friction} />}

        {/* Markov chain analytics */}
        {markovData && metadata && (
          <MarkovInsights analytics={markovData} conversionRate={metadata.conversion_rate} />
        )}

        {/* Data quality report — upload mode only */}
        {mode === 'upload' && validation && validation.issues.length > 0 && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <h2 className="text-sm font-medium mb-2">Data quality report</h2>
            <div className="space-y-1.5">
              {validation.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    issue.severity === 'error' ? 'bg-red-500' :
                    issue.severity === 'warning' ? 'bg-amber-500' : 'bg-gray-400 dark:bg-gray-600'
                  }`} />
                  <span className={
                    issue.severity === 'error' ? 'text-red-700 dark:text-red-400' :
                    issue.severity === 'warning' ? 'text-amber-700 dark:text-amber-400' :
                    'text-gray-500 dark:text-gray-400'
                  }>
                    {issue.message}
                    {issue.detail && (
                      <span className="text-gray-400 dark:text-gray-600 ml-1">({issue.detail})</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

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

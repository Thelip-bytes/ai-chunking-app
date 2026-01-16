import React, { useState } from 'react';
import RagChunker from './RagChunker';
import ManualRagChunker from './ManualRagChunker';
import { Database, UserCheck } from 'lucide-react';

function App() {
  const [mode, setMode] = useState(null); // 'auto' | 'manual' | null

  if (!mode) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
        <h1 className="text-4xl font-bold text-slate-800 mb-2">RAG Chunker Suite</h1>
        <p className="text-slate-500 mb-12">Select your processing workflow</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl w-full">
          {/* Card 1: Auto */}
          <button
            onClick={() => setMode('auto')}
            className="group relative bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-blue-300 transition-all text-left"
          >
            <div className="bg-blue-50 w-16 h-16 rounded-xl flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
              <Database size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors">Auto Chunking</h2>
            <p className="text-slate-500 leading-relaxed">
              Standard batch processing. Upload a file and let the AI or Algorithm process everything at once. Best for large datasets with trusted schemas.
            </p>
          </button>

          {/* Card 2: Manual */}
          <button
            onClick={() => setMode('manual')}
            className="group relative bg-white p-8 rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-purple-300 transition-all text-left"
          >
            <div className="bg-purple-50 w-16 h-16 rounded-xl flex items-center justify-center text-purple-600 mb-6 group-hover:scale-110 transition-transform">
              <UserCheck size={32} />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2 group-hover:text-purple-600 transition-colors">Manual AI Lab</h2>
            <p className="text-slate-500 leading-relaxed">
              Step-by-step verified processing. Review each document, check token counts, and rerun AI generation individually before accepting.
            </p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Global Navigation Override */}
      <div className="absolute top-0 left-0 p-2 z-[60]">
        <button
          onClick={() => setMode(null)}
          className="bg-white/90 backdrop-blur text-slate-500 hover:text-slate-800 px-3 py-1 rounded-full text-xs font-medium border border-slate-200 shadow-sm transition-colors"
        >
          ← Back to Menu
        </button>
      </div>

      {mode === 'auto' ? <RagChunker /> : <ManualRagChunker />}
    </div>
  );
}

export default App;
